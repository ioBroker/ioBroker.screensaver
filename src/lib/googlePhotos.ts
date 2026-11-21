/**
 * Google Photos through the Ambient API (https://developers.google.com/photos/ambient): the adapter is an "ambient
 * device" of the user; what it shows, the user chooses in the Google Photos app (albums, people, pets, …).
 *
 * The OAuth client of ioBroker lives in the OAuth service of ioBroker (`oauth2.iobroker.in/googlephotos`): the client
 * secret never reaches the adapter. The device flow (a code entered on google.com/device) needs no redirect to the
 * host, so it works behind every router.
 *
 * Limits of the API that shape this file: `mediaItems.list` at most 240 times per device and day, 100 items a page,
 * and a `baseUrl` of a picture that expires after about 60 minutes.
 */

import { toFloating } from './dateFilter';
import type { PictureSource, SourceEntry } from './sources';

/** The OAuth service of ioBroker */
export const OAUTH_URL = 'https://oauth2.iobroker.in/googlephotos';

const API_URL = 'https://photosambient.googleapis.com/v1';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** What the user grants: the name (for the consent screen) and the pictures of the ambient device */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/photosambient.mediaitems';

const TIMEOUT_MS = 30_000;

/** `mediaItems.list` is allowed 240 times per device and day; some are kept for the next day's first read */
export const DAILY_LIST_BUDGET = 200;

/** One page of `mediaItems.list`, the most the API gives */
const PAGE_SIZE = 100;

/** An album of Google Photos is read up to this many pictures: a frame shows a selection anyway */
export const MAX_GOOGLE_ITEMS = 500;

/** A `baseUrl` is good for 60 minutes; after this it is asked for again */
export const URL_LIFETIME_MS = 50 * 60_000;

/** Read the list of an album at most this often: the daily budget of the API is small */
export const MIN_LIST_INTERVAL_MS = 3 * 60 * 60_000;

/** Fresh addresses for the pictures at most this often */
const MIN_URL_REFRESH_MS = 20 * 60_000;

type FetchFn = typeof fetch;

export interface AmbientMediaSource {
    id: string;
    displayName?: string;
}

export interface AmbientDevice {
    id: string;
    displayName?: string;
    settingsUri?: string;
    mediaSourcesSet?: boolean;
    mediaSources?: AmbientMediaSource[];
    pollingConfig?: { pollInterval?: string };
    createTime?: string;
}

export interface AmbientMediaItem {
    id: string;
    createTime?: string;
    mediaFile?: {
        baseUrl?: string;
        mimeType?: string;
        mediaFileMetadata?: { width?: number | string; height?: number | string };
    };
}

/** What the OAuth service answers for a device code */
export interface DeviceCode {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval?: number;
}

export interface GoogleTokens {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
}

/** The answer of one poll for the tokens */
export type TokenPoll =
    | { kind: 'tokens'; tokens: GoogleTokens }
    | { kind: 'pending' }
    | { kind: 'slowDown' }
    | { kind: 'denied' }
    | { kind: 'expired' };

export class GoogleError extends Error {
    constructor(
        message: string,
        public readonly status = 0,
        /** OAuth error (`invalid_grant`) or the status of the API (`NOT_FOUND`) */
        public readonly code = '',
    ) {
        super(message);
    }
}

/**
 * A duration of the API, like `3.5s`, in milliseconds
 *
 * @param value - the duration
 * @param fallback - when it cannot be read
 */
export function parseDuration(value: unknown, fallback: number): number {
    const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(value.trim()) : null;
    return match ? Math.round(parseFloat(match[1]) * 1000) : fallback;
}

/**
 * Read an answer as JSON, whatever came
 *
 * @param response - the answer
 */
async function readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text().catch(() => '');
    try {
        const json: unknown = JSON.parse(text);
        return json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    } catch {
        return { error: text.substring(0, 200) };
    }
}

/**
 * The text of an error of Google: OAuth (`{error, error_description}`) or the API (`{error: {status, message}}`)
 *
 * @param body - the answer
 */
function describe(body: Record<string, unknown>): { code: string; text: string } {
    const error = body.error;
    if (error && typeof error === 'object') {
        const e = error as { status?: unknown; message?: unknown };
        const code = typeof e.status === 'string' ? e.status : '';
        return { code, text: typeof e.message === 'string' ? e.message : code };
    }
    const code = typeof error === 'string' ? error : '';
    const description = typeof body.error_description === 'string' ? body.error_description : '';
    return { code, text: description || code };
}

/** The OAuth service of ioBroker: device code, tokens, a new access token */
export class OAuthProxy {
    constructor(
        private readonly base = OAUTH_URL,
        private readonly fetchFn: FetchFn = fetch,
    ) {}

    private async post(
        path: string,
        body: Record<string, string>,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
        let response: Response;
        try {
            response = await this.fetchFn(`${this.base}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (e) {
            throw new GoogleError(
                `The OAuth service of ioBroker is not reachable: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        return { status: response.status, body: await readJson(response) };
    }

    /**
     * A code the user enters on google.com/device
     *
     * @param requestId - the request ID the device will be created with: the consent then ends in its settings
     * @param displayName - the name of the device in Google Photos
     */
    async deviceCode(requestId: string, displayName: string): Promise<DeviceCode> {
        const { status, body } = await this.post('/device', { requestId, displayName });
        if (status !== 200 || typeof body.device_code !== 'string' || typeof body.user_code !== 'string') {
            const { code, text } = describe(body);
            throw new GoogleError(`No code from Google (${status}): ${text || 'unknown answer'}`, status, code);
        }
        return {
            device_code: body.device_code,
            user_code: body.user_code,
            verification_url:
                typeof body.verification_url === 'string' ? body.verification_url : 'https://www.google.com/device',
            expires_in: Number(body.expires_in) || 1800,
            interval: Number(body.interval) || 5,
        };
    }

    /**
     * Has the user agreed yet
     *
     * @param deviceCode - from `deviceCode()`
     */
    async pollToken(deviceCode: string): Promise<TokenPoll> {
        const { status, body } = await this.post('/token', { device_code: deviceCode });
        if (status === 200 && typeof body.access_token === 'string') {
            return { kind: 'tokens', tokens: body as unknown as GoogleTokens };
        }
        const { code, text } = describe(body);
        switch (code) {
            case 'authorization_pending':
                return { kind: 'pending' };
            case 'slow_down':
                return { kind: 'slowDown' };
            case 'access_denied':
                return { kind: 'denied' };
            case 'expired_token':
                return { kind: 'expired' };
            default:
                throw new GoogleError(
                    `Google refused the sign-in (${status}): ${text || 'unknown answer'}`,
                    status,
                    code,
                );
        }
    }

    /**
     * A new access token
     *
     * @param refreshToken - kept by the adapter
     */
    async refresh(refreshToken: string): Promise<GoogleTokens> {
        const { status, body } = await this.post('/refresh', { refresh_token: refreshToken });
        if (status === 200 && typeof body.access_token === 'string') {
            return body as unknown as GoogleTokens;
        }
        const { code, text } = describe(body);
        throw new GoogleError(`No access token from Google (${status}): ${text || 'unknown answer'}`, status, code);
    }

    /**
     * Withdraw the consent; needs no client secret, so it goes to Google directly
     *
     * @param token - the refresh token
     */
    async revoke(token: string): Promise<void> {
        await this.fetchFn(REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        }).catch(() => undefined);
    }
}

/** The access token of one account: asked for when needed, kept until shortly before it ends */
export class GoogleSession {
    private accessToken = '';
    private validUntil = 0;
    private pending: Promise<string> | null = null;

    constructor(
        private readonly oauth: OAuthProxy,
        public readonly refreshToken: string,
        private readonly now: () => number = Date.now,
    ) {}

    /** @param force - the API refused the current one */
    token(force = false): Promise<string> {
        if (!force && this.accessToken && this.now() < this.validUntil) {
            return Promise.resolve(this.accessToken);
        }
        if (this.pending === null) {
            this.pending = this.oauth
                .refresh(this.refreshToken)
                .then(tokens => {
                    this.accessToken = tokens.access_token;
                    this.validUntil = this.now() + Math.max(60, (Number(tokens.expires_in) || 3600) - 120) * 1000;
                    return this.accessToken;
                })
                .finally(() => {
                    this.pending = null;
                });
        }
        return this.pending;
    }

    /**
     * Take the tokens of the sign-in, so the first call needs no refresh
     *
     * @param tokens - as Google gave them
     */
    seed(tokens: GoogleTokens): void {
        this.accessToken = tokens.access_token;
        this.validUntil = this.now() + Math.max(60, (Number(tokens.expires_in) || 3600) - 120) * 1000;
    }
}

/**
 * The local day of a time, for the daily budget
 *
 * @param time - ms
 */
function dayOf(time: number): string {
    const date = new Date(time);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** The REST API of the ambient device */
export class AmbientClient {
    private budgetDay = '';
    private budgetUsed = 0;

    constructor(
        private readonly session: GoogleSession,
        private readonly fetchFn: FetchFn = fetch,
        private readonly now: () => number = Date.now,
    ) {}

    private async request(
        method: string,
        path: string,
        body?: unknown,
        retried = false,
    ): Promise<Record<string, unknown>> {
        const token = await this.session.token(retried);
        let response: Response;
        try {
            response = await this.fetchFn(`${API_URL}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (e) {
            throw new GoogleError(`Google Photos is not reachable: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (response.status === 401 && !retried) {
            return this.request(method, path, body, true);
        }
        const json = await readJson(response);
        if (!response.ok) {
            const { code, text } = describe(json);
            throw new GoogleError(
                `Google Photos answered ${response.status}: ${text || response.statusText}`,
                response.status,
                code,
            );
        }
        return json;
    }

    /**
     * Register the device; its settings in the app are where the user chooses the pictures
     *
     * @param requestId - the UUID the device code was asked with
     * @param displayName - the name in Google Photos
     */
    async createDevice(requestId: string, displayName: string): Promise<AmbientDevice> {
        return (await this.request('POST', `/devices?requestId=${encodeURIComponent(requestId)}`, {
            displayName,
        })) as unknown as AmbientDevice;
    }

    /** @param id - the device */
    async getDevice(id: string): Promise<AmbientDevice> {
        return (await this.request('GET', `/devices/${encodeURIComponent(id)}`)) as unknown as AmbientDevice;
    }

    /** @param id - the device, or the request ID it was created with */
    async deleteDevice(id: string): Promise<void> {
        await this.request('DELETE', `/devices/${encodeURIComponent(id)}`);
    }

    /** Calls of `mediaItems.list` left today */
    get budgetLeft(): number {
        if (this.budgetDay !== dayOf(this.now())) {
            return DAILY_LIST_BUDGET;
        }
        return Math.max(0, DAILY_LIST_BUDGET - this.budgetUsed);
    }

    /**
     * One page of the pictures of the device
     *
     * @param deviceId - the device
     * @param mediaSourceId - one of the sources chosen in the app; without, the selection of Google
     * @param pageToken - from the page before
     */
    async listMediaItems(
        deviceId: string,
        mediaSourceId?: string,
        pageToken?: string,
    ): Promise<{ mediaItems: AmbientMediaItem[]; nextPageToken?: string }> {
        const day = dayOf(this.now());
        if (this.budgetDay !== day) {
            this.budgetDay = day;
            this.budgetUsed = 0;
        }
        if (this.budgetUsed >= DAILY_LIST_BUDGET) {
            throw new GoogleError(
                'Google Photos was asked too often today; the pictures come again tomorrow',
                429,
                'BUDGET',
            );
        }
        this.budgetUsed++;
        const query = new URLSearchParams({ deviceId, pageSize: String(PAGE_SIZE) });
        if (mediaSourceId) {
            query.set('mediaSourceId', mediaSourceId);
        }
        if (pageToken) {
            query.set('pageToken', pageToken);
        }
        const answer = await this.request('GET', `/mediaItems?${query.toString()}`);
        return {
            mediaItems: Array.isArray(answer.mediaItems) ? (answer.mediaItems as AmbientMediaItem[]) : [],
            nextPageToken:
                typeof answer.nextPageToken === 'string' && answer.nextPageToken ? answer.nextPageToken : undefined,
        };
    }

    /**
     * A picture in a size: Google reduces it itself
     *
     * @param baseUrl - of the media item, younger than 60 minutes
     * @param edge - the longest edge
     */
    async download(baseUrl: string, edge: number): Promise<Buffer> {
        let response: Response;
        try {
            response = await this.fetchFn(`${baseUrl}=w${edge}-h${edge}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (e) {
            throw new GoogleError(
                `A picture of Google Photos cannot be loaded: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        if (!response.ok) {
            throw new GoogleError(`A picture of Google Photos cannot be loaded: ${response.status}`, response.status);
        }
        return Buffer.from(await response.arrayBuffer());
    }
}

/** What a source of Google Photos needs of the connection */
export interface GoogleAccess {
    /** The client and the device, when connected and the user chose what to show; null otherwise */
    access(): { client: AmbientClient; deviceId: string; sources: AmbientMediaSource[] } | null;
    /** Read the device again: the user may have chosen other sources in the app */
    refreshSources(): Promise<AmbientMediaSource[]>;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * A media item as a picture of an album
 *
 * @param item - as listed
 */
export function itemToEntry(item: AmbientMediaItem): SourceEntry {
    const mime = item.mediaFile?.mimeType || '';
    const meta = item.mediaFile?.mediaFileMetadata;
    const width = Number(meta?.width) || undefined;
    const height = Number(meta?.height) || undefined;
    const created = item.createTime ? Date.parse(item.createTime) : NaN;
    return {
        key: item.id,
        // sized copies of Google are JPEGs; a GIF stays a GIF
        name: `${item.id}.${EXTENSIONS[mime] === 'gif' ? 'gif' : 'jpg'}`,
        date: Number.isFinite(created) ? toFloating(new Date(created)) : undefined,
        width,
        height,
        known: true,
    };
}

/**
 * The pictures of the ambient device: the selection of Google, or one of the sources the user chose in the app.
 *
 * `location` is the name or the ID of a chosen source (an album, a person, …), empty for the selection of Google.
 */
export class GoogleSource implements PictureSource {
    private readonly urls = new Map<string, string>();
    private listedAt = 0;
    private urlsAt = 0;
    private entries: SourceEntry[] = [];
    private refreshing: Promise<void> | null = null;

    constructor(
        private readonly google: GoogleAccess,
        private readonly location: string,
        private readonly now: () => number = Date.now,
    ) {}

    private connected(): NonNullable<ReturnType<GoogleAccess['access']>> {
        const access = this.google.access();
        if (!access) {
            throw new GoogleError('Google Photos is not connected: connect it in the settings of the instance');
        }
        return access;
    }

    private async sourceId(): Promise<string | undefined> {
        const wanted = this.location.trim();
        if (!wanted) {
            return undefined;
        }
        const find = (sources: AmbientMediaSource[]): AmbientMediaSource | undefined =>
            sources.find(source => source.id === wanted) ||
            sources.find(source => (source.displayName || '').toLowerCase() === wanted.toLowerCase());
        const found = find(this.connected().sources) || find(await this.google.refreshSources());
        if (!found) {
            const names = this.connected()
                .sources.map(source => source.displayName || source.id)
                .join(', ');
            throw new GoogleError(
                `"${wanted}" is not chosen for ioBroker in Google Photos${names ? ` (chosen: ${names})` : ''}`,
                404,
            );
        }
        return found.id;
    }

    /** Read the pictures from Google: up to `MAX_GOOGLE_ITEMS`, without videos */
    private async fetchAll(): Promise<void> {
        const { client, deviceId } = this.connected();
        const mediaSourceId = await this.sourceId();
        const entries: SourceEntry[] = [];
        const urls = new Map<string, string>();
        let pageToken: string | undefined;
        const pages = Math.ceil(MAX_GOOGLE_ITEMS / PAGE_SIZE);
        for (let page = 0; page < pages; page++) {
            const answer = await client.listMediaItems(deviceId, mediaSourceId, pageToken);
            let fresh = 0;
            for (const item of answer.mediaItems) {
                const mime = item.mediaFile?.mimeType || '';
                if (!item.id || !item.mediaFile?.baseUrl || urls.has(item.id) || (mime && !mime.startsWith('image/'))) {
                    continue;
                }
                urls.set(item.id, item.mediaFile.baseUrl);
                entries.push(itemToEntry(item));
                fresh++;
            }
            pageToken = answer.nextPageToken;
            // the selection of Google may go on and on, and repeat itself
            if (!pageToken || (!fresh && answer.mediaItems.length) || entries.length >= MAX_GOOGLE_ITEMS) {
                break;
            }
        }
        this.entries = entries;
        this.urls.clear();
        for (const [id, url] of urls) {
            this.urls.set(id, url);
        }
        this.listedAt = this.urlsAt = this.now();
    }

    async list(): Promise<SourceEntry[]> {
        if (this.entries.length && this.now() - this.listedAt < MIN_LIST_INTERVAL_MS) {
            // the daily budget of the API is small: the list of a few hours ago is still good
            return this.entries;
        }
        await this.fetchAll();
        return this.entries;
    }

    readHead(): Promise<Uint8Array> {
        // never asked: Google tells the date and the size itself
        return Promise.resolve(new Uint8Array(0));
    }

    private async freshUrls(): Promise<void> {
        if (this.now() - this.urlsAt < MIN_URL_REFRESH_MS) {
            return;
        }
        if (this.refreshing === null) {
            this.refreshing = this.fetchAll().finally(() => {
                this.refreshing = null;
            });
        }
        await this.refreshing;
    }

    async read(key: string, edge: number): Promise<Buffer> {
        const { client } = this.connected();
        if (!this.urls.has(key) || this.now() - this.urlsAt > URL_LIFETIME_MS) {
            await this.freshUrls();
        }
        const url = this.urls.get(key);
        if (!url) {
            throw new GoogleError('The picture is not in the selection of Google Photos any more', 404);
        }
        return client.download(url, edge);
    }
}
