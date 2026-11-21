/**
 * The connection to Google Photos: sign-in with a code (device flow), the ambient device, waiting until the user
 * chose in the app what to show, and the way back out.
 *
 *   disconnected ──connect()──▶ code ──consent──▶ sources ──chosen in the app──▶ connected
 *        ▲                       │                                                │
 *        └──────disconnect()─────┴──────── expired (token revoked) / gone (device deleted in the app)
 *
 * The account (refresh token, device) is kept by the adapter, encrypted; this class only tells it what to keep.
 */

import { randomUUID } from 'node:crypto';

import {
    AmbientClient,
    GOOGLE_SCOPE,
    GoogleError,
    GoogleSession,
    parseDuration,
    type AmbientDevice,
    type AmbientMediaSource,
    type GoogleAccess,
    type GoogleTokens,
    type OAuthProxy,
} from './googlePhotos';
import { escapeHtml, link } from './html';

export interface GoogleAccount {
    refreshToken: string;
    deviceId: string;
    requestId: string;
    displayName: string;
}

export type GoogleStatus =
    | { state: 'disconnected' }
    | { state: 'code'; userCode: string; verificationUrl: string; expiresAt: number }
    | { state: 'sources'; settingsUri: string }
    | { state: 'connected'; settingsUri: string; sources: AmbientMediaSource[] }
    /** The refresh token was revoked or ran out (7 days while the OAuth app of Google is in testing) */
    | { state: 'expired' }
    /** The device was removed in the Google Photos app */
    | { state: 'gone' }
    /** The user said no on the consent screen, or did not enter the code in time */
    | { state: 'denied' }
    /** Google keeps the Ambient API closed for the OAuth client of ioBroker: only partners of Google Photos may use it */
    | { state: 'notAllowed' }
    | { state: 'error'; message: string };

type FetchFn = typeof fetch;

export interface GoogleConnectionOptions {
    oauth: OAuthProxy;
    /** The name of the device in Google Photos, like "ioBroker raspberrypi" */
    displayName: string;
    loadAccount(): Promise<GoogleAccount | null>;
    saveAccount(account: GoogleAccount | null): Promise<void>;
    onStatus(status: GoogleStatus): void;
    /** The user chose what to show (or chose again): read the albums of Google */
    onSourcesChosen(): void;
    log: { info(text: string): void; warn(text: string): void; debug(text: string): void };
    fetchFn?: FetchFn;
    now?: () => number;
    /** Wait; resolves early when the signal aborts */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    uuid?: () => string;
}

/** How long the device is asked at its own pace whether sources were chosen; then only now and then */
const FAST_SOURCE_POLL_MS = 30 * 60_000;
const SLOW_SOURCE_POLL_MS = 10 * 60_000;

/**
 * Wait, or less when aborted
 *
 * @param ms - how long
 * @param signal - aborts
 */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(done, ms);
        function done(): void {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done);
    });
}

/**
 * Google refuses the Ambient API to an OAuth client that is not in the partner program of Google Photos
 *
 * @param e - what was thrown
 */
function isNotAllowed(e: unknown): boolean {
    return (
        e instanceof GoogleError &&
        e.status === 403 &&
        (e.code === 'PERMISSION_DENIED' || /partner program/i.test(e.message))
    );
}

/**
 * A text of an error
 *
 * @param e - what was thrown
 */
function errorText(e: unknown): string {
    return e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
}

export class GoogleConnection implements GoogleAccess {
    private account: GoogleAccount | null = null;
    private client: AmbientClient | null = null;
    private device: AmbientDevice | null = null;
    private current: GoogleStatus = { state: 'disconnected' };
    /** Aborts what runs now: a sign-in, a wait for sources */
    private running = new AbortController();
    private stopped = false;
    private readonly now: () => number;
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    private readonly uuid: () => string;

    constructor(private readonly options: GoogleConnectionOptions) {
        this.now = options.now || Date.now;
        this.sleep = options.sleep || defaultSleep;
        this.uuid = options.uuid || randomUUID;
    }

    get status(): GoogleStatus {
        return this.current;
    }

    private setStatus(status: GoogleStatus): void {
        this.current = status;
        this.options.onStatus(status);
    }

    /** Stop what runs and start anew */
    private restart(): AbortSignal {
        this.running.abort();
        this.running = new AbortController();
        return this.running.signal;
    }

    /**
     * A client of the API for a refresh token
     *
     * @param refreshToken - of the account
     * @param tokens - of the sign-in: the first call needs no refresh then
     */
    private makeClient(refreshToken: string, tokens?: GoogleTokens): AmbientClient {
        const session = new GoogleSession(this.options.oauth, refreshToken, this.now);
        if (tokens) {
            session.seed(tokens);
        }
        return new AmbientClient(session, this.options.fetchFn, this.now);
    }

    private use(account: GoogleAccount, client = this.makeClient(account.refreshToken)): AmbientClient {
        this.account = account;
        this.client = client;
        return client;
    }

    /** The adapter started: take the stored account and see whether the device is still there */
    async start(): Promise<void> {
        const account = await this.options.loadAccount();
        if (!account?.refreshToken || !account.deviceId) {
            this.setStatus({ state: 'disconnected' });
            return;
        }
        const client = this.use(account);
        await this.check(this.restart(), client, account.deviceId);
    }

    /**
     * Read the device: still there, sources chosen
     *
     * @param signal - aborts a wait for sources
     * @param client - of the account
     * @param deviceId - the device of the account
     */
    private async check(signal: AbortSignal, client: AmbientClient, deviceId: string): Promise<void> {
        try {
            const device = await client.getDevice(deviceId);
            this.device = device;
            if (device.mediaSourcesSet) {
                this.setStatus({
                    state: 'connected',
                    settingsUri: device.settingsUri || '',
                    sources: device.mediaSources || [],
                });
            } else {
                this.setStatus({ state: 'sources', settingsUri: device.settingsUri || '' });
                void this.waitForSources(signal);
            }
        } catch (e) {
            this.fail(e);
        }
    }

    /**
     * What an error means for the connection
     *
     * @param e - what was thrown
     */
    private fail(e: unknown): void {
        if (isNotAllowed(e)) {
            this.options.log.warn(
                'Google Photos: Google keeps the Ambient API closed for the OAuth client of ioBroker (partner program of Google Photos)',
            );
            this.device = null;
            this.setStatus({ state: 'notAllowed' });
        } else if (e instanceof GoogleError && (e.code === 'invalid_grant' || e.code === 'unauthorized_client')) {
            this.options.log.warn('Google Photos: the sign-in ran out or was revoked; connect again in the settings');
            this.device = null;
            this.setStatus({ state: 'expired' });
        } else if (e instanceof GoogleError && e.status === 404) {
            this.options.log.warn('Google Photos: the device was removed in the Google Photos app; connect again');
            this.device = null;
            this.setStatus({ state: 'gone' });
        } else {
            // Google or the OAuth service is not reachable now: the albums keep what they had
            this.options.log.warn(`Google Photos: ${errorText(e)}`);
            this.setStatus({ state: 'error', message: errorText(e) });
        }
    }

    /**
     * Ask the device until the user chose sources in the app: at the pace it asks for, later slower
     *
     * @param signal - aborts
     */
    private async waitForSources(signal: AbortSignal): Promise<void> {
        const fast = parseDuration(this.device?.pollingConfig?.pollInterval, 5000);
        const started = this.now();
        while (!signal.aborted && !this.stopped) {
            await this.sleep(
                this.now() - started < FAST_SOURCE_POLL_MS ? Math.max(3000, fast) : SLOW_SOURCE_POLL_MS,
                signal,
            );
            if (signal.aborted || this.stopped || !this.client || !this.account) {
                return;
            }
            try {
                const device = await this.client.getDevice(this.account.deviceId);
                this.device = device;
                if (device.mediaSourcesSet) {
                    this.options.log.info(
                        `Google Photos: chosen to show: ${(device.mediaSources || []).map(source => source.displayName || source.id).join(', ') || 'the selection of Google'}`,
                    );
                    this.setStatus({
                        state: 'connected',
                        settingsUri: device.settingsUri || '',
                        sources: device.mediaSources || [],
                    });
                    this.options.onSourcesChosen();
                    return;
                }
            } catch (e) {
                this.fail(e);
                if (this.current.state !== 'error') {
                    return;
                }
            }
        }
    }

    /**
     * Start a sign-in: the code for google.com/device. The rest runs on: tokens, device, sources.
     *
     * @returns the code, and where to enter it
     */
    async connect(): Promise<{ userCode: string; verificationUrl: string; expiresIn: number }> {
        const signal = this.restart();
        const requestId = this.uuid();
        const displayName = this.options.displayName.substring(0, 100);
        const code = await this.options.oauth.deviceCode(requestId, displayName);
        const expiresAt = this.now() + code.expires_in * 1000;
        this.setStatus({ state: 'code', userCode: code.user_code, verificationUrl: code.verification_url, expiresAt });
        void this.waitForConsent(signal, code.device_code, code.interval || 5, expiresAt, requestId, displayName);
        return { userCode: code.user_code, verificationUrl: code.verification_url, expiresIn: code.expires_in };
    }

    private async waitForConsent(
        signal: AbortSignal,
        deviceCode: string,
        interval: number,
        expiresAt: number,
        requestId: string,
        displayName: string,
    ): Promise<void> {
        let seconds = Math.max(1, interval);
        while (!signal.aborted && !this.stopped) {
            await this.sleep(seconds * 1000, signal);
            if (signal.aborted || this.stopped) {
                return;
            }
            if (this.now() > expiresAt) {
                this.setStatus({ state: 'denied' });
                return;
            }
            try {
                const poll = await this.options.oauth.pollToken(deviceCode);
                if (poll.kind === 'pending') {
                    continue;
                }
                if (poll.kind === 'slowDown') {
                    seconds += 5;
                    continue;
                }
                if (poll.kind === 'denied' || poll.kind === 'expired') {
                    this.setStatus({ state: 'denied' });
                    return;
                }
                await this.finish(signal, poll.tokens, requestId, displayName);
                return;
            } catch (e) {
                this.fail(e);
                return;
            }
        }
    }

    /** The user agreed: register the device, keep the account, wait for the sources */
    private async finish(
        signal: AbortSignal,
        tokens: GoogleTokens,
        requestId: string,
        displayName: string,
    ): Promise<void> {
        if (!tokens.refresh_token) {
            throw new GoogleError('Google gave no refresh token');
        }
        if (tokens.scope && !tokens.scope.split(' ').includes(GOOGLE_SCOPE)) {
            throw new GoogleError('Access to Google Photos was not granted');
        }
        const previous = this.account;
        const client = this.makeClient(tokens.refresh_token, tokens);
        let device: AmbientDevice;
        try {
            device = await client.createDevice(requestId, displayName);
            if (!device.id) {
                throw new GoogleError('Google Photos did not register the device');
            }
        } catch (e) {
            // without a device the consent is of no use: withdraw it, so it does not linger in the Google account.
            // An account connected before stays as it was.
            await this.options.oauth.revoke(tokens.refresh_token);
            throw e;
        }
        const account: GoogleAccount = {
            refreshToken: tokens.refresh_token,
            deviceId: device.id,
            requestId,
            displayName,
        };
        this.use(account, client);
        this.device = device;
        await this.options.saveAccount(account);
        this.options.log.info(`Google Photos: connected as device "${displayName}"`);
        if (previous) {
            // a new sign-in replaces the old device: remove it, so the user does not see it twice in the app
            await this.removeDevice(previous).catch(() => undefined);
        }
        if (device.mediaSourcesSet) {
            this.setStatus({
                state: 'connected',
                settingsUri: device.settingsUri || '',
                sources: device.mediaSources || [],
            });
            this.options.onSourcesChosen();
        } else {
            this.setStatus({ state: 'sources', settingsUri: device.settingsUri || '' });
            await this.waitForSources(signal);
        }
    }

    private async removeDevice(account: GoogleAccount): Promise<void> {
        const session = new GoogleSession(this.options.oauth, account.refreshToken, this.now);
        const client = new AmbientClient(session, this.options.fetchFn, this.now);
        await client.deleteDevice(account.deviceId || account.requestId);
        await this.options.oauth.revoke(account.refreshToken);
    }

    /** Remove the device in Google Photos, withdraw the consent, forget the account */
    async disconnect(): Promise<void> {
        this.restart();
        const account = this.account;
        this.account = null;
        this.client = null;
        this.device = null;
        if (account) {
            try {
                await this.removeDevice(account);
            } catch (e) {
                // gone already or not reachable: the account is forgotten anyway
                this.options.log.debug(`Google Photos: the device was not removed: ${errorText(e)}`);
            }
        }
        await this.options.saveAccount(null);
        this.setStatus({ state: 'disconnected' });
    }

    /** Where the user chooses in the app what to show */
    get settingsUri(): string {
        return this.device?.settingsUri || '';
    }

    access(): ReturnType<GoogleAccess['access']> {
        if (!this.client || !this.account?.deviceId || this.current.state !== 'connected') {
            return null;
        }
        return { client: this.client, deviceId: this.account.deviceId, sources: this.current.sources };
    }

    async refreshSources(): Promise<AmbientMediaSource[]> {
        if (!this.client || !this.account?.deviceId) {
            return [];
        }
        try {
            const device = await this.client.getDevice(this.account.deviceId);
            this.device = device;
            if (device.mediaSourcesSet) {
                this.setStatus({
                    state: 'connected',
                    settingsUri: device.settingsUri || '',
                    sources: device.mediaSources || [],
                });
            }
            return device.mediaSources || [];
        } catch (e) {
            this.fail(e);
            return [];
        }
    }

    stop(): void {
        this.stopped = true;
        this.running.abort();
    }
}

/** The words of the status, in the language of the system: `admin/i18n/<lang>.json` */
export type Words = (key: string, ...args: string[]) => string;

/**
 * The status for the settings of the instance (a `state` control with `html`)
 *
 * @param status - of the connection
 * @param word - the words
 * @param timeText - a time as the user reads it, like 14:35
 */
export function statusHtml(status: GoogleStatus, word: Words, timeText: (time: number) => string): string {
    switch (status.state) {
        case 'disconnected':
            return escapeHtml(word('google_status_disconnected'));
        case 'code': {
            const url = status.verificationUrl.replace(/^https?:\/\/(www\.)?/i, '');
            return [
                `<div>${escapeHtml(word('google_status_code', '\u0000')).replace('\u0000', link(status.verificationUrl, url))}</div>`,
                `<div style="font-size:2em;font-weight:bold;letter-spacing:0.12em;margin:0.3em 0">${escapeHtml(status.userCode)}</div>`,
                `<div>${escapeHtml(word('google_status_code_until', timeText(status.expiresAt)))}</div>`,
            ].join('');
        }
        case 'sources':
            return `${escapeHtml(word('google_status_sources'))} ${link(status.settingsUri, word('google_status_open_app'))}`;
        case 'connected': {
            const names = status.sources.map(source => source.displayName || source.id).filter(Boolean);
            return `${escapeHtml(word('google_status_connected', names.length ? names.join(', ') : word('google_status_curated')))} ${link(status.settingsUri, word('google_status_change'))}`;
        }
        case 'expired':
            return escapeHtml(word('google_status_expired'));
        case 'gone':
            return escapeHtml(word('google_status_gone'));
        case 'denied':
            return escapeHtml(word('google_status_denied'));
        case 'notAllowed':
            return `${escapeHtml(word('google_status_not_allowed'))} ${link('https://developers.google.com/photos/partner-program/overview', word('google_status_partner'))}`;
        case 'error':
            return escapeHtml(word('google_status_error', status.message));
    }
}
