/**
 * Immich in Docker on the host of the instance.
 *
 * The containers come from `docker-compose.yaml` through `@iobroker/plugin-docker`; this connects the adapter to the
 * server they run: it waits until the server answers, creates the first account (the administrator) of a new Immich
 * with the e-mail and the password of the settings, signs in and creates an API key that may only read pictures and
 * albums. The key is kept, so the next start needs no sign-in; the password is only needed again when the key is
 * gone.
 */

import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

import { escapeHtml, link } from './html';
import { ImmichClient, ImmichError } from './immich';

type FetchFn = typeof fetch;

/** What the key of the adapter may do: read, nothing else */
export const IMMICH_KEY_PERMISSIONS = ['asset.read', 'asset.view', 'asset.download', 'album.read'];

/** How long one request to the server may take */
const REQUEST_TIMEOUT_MS = 20_000;

/** The settings of Immich in Docker (`native.dockerImmich`) */
export interface ImmichDockerSettings {
    enabled: boolean;
    /** The IP the server listens on: 0.0.0.0 for the whole network */
    bind: string;
    port: number;
    /** The folder of the photos on the host */
    location: string;
    machineLearning: boolean;
    autoImageUpdate: boolean;
    stopIfInstanceStopped: boolean;
}

/**
 * The settings as stored, with the defaults of `io-package.json` for what is missing
 *
 * @param native - `native.dockerImmich` of the instance
 */
export function readDockerSettings(native: Partial<ImmichDockerSettings> | undefined): ImmichDockerSettings {
    const port = parseInt(String(native?.port ?? ''), 10);
    return {
        enabled: !!native?.enabled,
        bind: String(native?.bind || '0.0.0.0').trim(),
        port: port > 0 && port < 65536 ? port : 2283,
        location: String(native?.location || '').trim(),
        machineLearning: !!native?.machineLearning,
        autoImageUpdate: native?.autoImageUpdate !== false,
        stopIfInstanceStopped: !!native?.stopIfInstanceStopped,
    };
}

/**
 * Where the adapter reaches the server: the published port on this host
 *
 * @param settings - of Immich in Docker
 */
export function serverUrl(settings: Pick<ImmichDockerSettings, 'bind' | 'port'>): string {
    const bind = settings.bind;
    const host = !bind || bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind.includes(':') ? `[${bind}]` : bind;
    return `http://${host}:${settings.port}`;
}

/** Interfaces of Docker and of virtual machines: their addresses are of no use to a phone */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|cni|flannel|lxc|vEthernet)/i;

/**
 * The addresses for the app on the phone and for the browser; empty when the server only listens on this host
 *
 * @param settings - of Immich in Docker
 * @param interfaces - the network interfaces of the host
 */
export function appAddresses(
    settings: Pick<ImmichDockerSettings, 'bind' | 'port'>,
    interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
    const bind = settings.bind || '0.0.0.0';
    if (bind.startsWith('127.') || bind === '::1' || bind === 'localhost') {
        return [];
    }
    if (bind !== '0.0.0.0' && bind !== '::') {
        return [serverUrl(settings)];
    }
    const result: string[] = [];
    for (const [name, addresses] of Object.entries(interfaces)) {
        if (VIRTUAL_INTERFACE.test(name)) {
            continue;
        }
        for (const address of addresses || []) {
            if (address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.')) {
                result.push(`http://${address.address}:${settings.port}`);
            }
        }
    }
    return result;
}

/** The key of the adapter, as it is kept (the secret encrypted by the adapter) */
export interface ImmichKey {
    /** Where the server was reached when the key was made or last used */
    url: string;
    /** The account that created it */
    email: string;
    keyId: string;
    secret: string;
}

export type ImmichDockerStatus =
    /** The folder of the photos is not set: the containers are not started */
    | { state: 'noFolder' }
    /** The folder of the photos does not exist and ioBroker may not create it: Docker would not start the server */
    | { state: 'folderMissing'; folder: string }
    /** Waiting for the server: Docker pulls the images, the database starts */
    | { state: 'starting' }
    /** The server runs, but there is no key and no e-mail and password to create one */
    | { state: 'noAccount' }
    /** The server refused the e-mail or the password */
    | { state: 'loginFailed' }
    | { state: 'ready'; user: string }
    | { state: 'error'; message: string };

export interface ImmichDockerOptions {
    /** Where the adapter reaches the server */
    url: string;
    email: string;
    password: string;
    /** The name of the key in Immich */
    keyName: string;
    loadKey: () => Promise<ImmichKey | null>;
    saveKey: (key: ImmichKey) => Promise<void>;
    onStatus: (status: ImmichDockerStatus) => void;
    /** The server can be read now */
    onReady: (client: ImmichClient) => void;
    log: { info: (text: string) => void; warn: (text: string) => void; debug: (text: string) => void };
    fetchFn?: FetchFn;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    /** How often the server is asked while it starts */
    pollMs?: number;
    /** After an error: when the next try is made */
    retryMs?: number;
}

/** Ends the setup until the settings change: they restart the instance */
class SetupStop extends Error {
    constructor(public readonly status: ImmichDockerStatus) {
        super(status.state);
    }
}

/**
 * Wait, unless the instance stops
 *
 * @param ms - how long
 * @param signal - stops the wait
 */
function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
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
 * The text of an error
 *
 * @param e - what was thrown
 */
function errorText(e: unknown): string {
    return e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
}

/**
 * Two e-mail addresses are the same account in Immich regardless of case
 *
 * @param a - one address
 * @param b - another
 */
function sameEmail(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The connection of the adapter to Immich in Docker */
export class ImmichDocker {
    private state: ImmichDockerStatus = { state: 'starting' };
    private current: ImmichClient | null = null;
    private readonly abort = new AbortController();
    private readonly fetchFn: FetchFn;
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

    constructor(private readonly options: ImmichDockerOptions) {
        this.fetchFn = options.fetchFn || fetch;
        this.sleep = options.sleep || wait;
    }

    get status(): ImmichDockerStatus {
        return this.state;
    }

    get ready(): boolean {
        return this.current !== null;
    }

    /** The client of the server; throws while it is not ready */
    client(): ImmichClient {
        if (!this.current) {
            throw new ImmichError(`Immich in Docker is not ready yet (${this.state.state})`);
        }
        return this.current;
    }

    private setStatus(status: ImmichDockerStatus): void {
        this.state = status;
        this.options.onStatus(status);
    }

    /** Connect; runs until the server is ready, the settings must change, or the instance stops */
    async start(): Promise<void> {
        const signal = this.abort.signal;
        this.setStatus({ state: 'starting' });
        while (!signal.aborted) {
            await this.waitForServer(signal);
            if (signal.aborted) {
                return;
            }
            try {
                const { client, user } = await this.connect();
                if (signal.aborted) {
                    return;
                }
                this.current = client;
                this.setStatus({ state: 'ready', user });
                this.options.onReady(client);
                return;
            } catch (e) {
                if (signal.aborted) {
                    return;
                }
                if (e instanceof SetupStop) {
                    this.setStatus(e.status);
                    return;
                }
                // the server answers the ping, but not yet everything else (migrations after an update)
                this.options.log.warn(`Immich in Docker: ${errorText(e)}`);
                this.setStatus({ state: 'error', message: errorText(e) });
                await this.sleep(this.options.retryMs ?? 60_000, signal);
            }
        }
    }

    stop(): void {
        this.abort.abort();
    }

    private async waitForServer(signal: AbortSignal): Promise<void> {
        let told = false;
        while (!signal.aborted) {
            try {
                const answer = await this.call<{ res?: string }>('GET', '/server/ping');
                if (answer.res === 'pong') {
                    if (told) {
                        this.options.log.info('Immich in Docker answers');
                    }
                    return;
                }
            } catch {
                // not up yet
            }
            if (!told) {
                told = true;
                this.options.log.info(
                    `Waiting for Immich in Docker at ${this.options.url}; on the first start Docker downloads the images`,
                );
                if (this.state.state !== 'starting') {
                    this.setStatus({ state: 'starting' });
                }
            }
            await this.sleep(this.options.pollMs ?? 10_000, signal);
        }
    }

    /** A request without the key of the adapter: sign-up, sign-in and the keys */
    private async call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        let response: Response;
        try {
            response = await this.fetchFn(`${this.options.url}/api${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
            });
        } catch (e) {
            throw new ImmichError(`Immich is not reachable: ${errorText(e)}`);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            let message = text.substring(0, 200) || response.statusText;
            try {
                const parsed = JSON.parse(text) as { message?: unknown };
                if (parsed.message) {
                    message =
                        typeof parsed.message === 'string'
                            ? parsed.message
                            : Array.isArray(parsed.message)
                              ? parsed.message.join(', ')
                              : JSON.stringify(parsed.message);
                }
            } catch {
                // not JSON
            }
            throw new ImmichError(`Immich answered ${response.status} for ${path}: ${message}`, response.status);
        }
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
    }

    /** The kept key if it still works, else a new one */
    private async connect(): Promise<{ client: ImmichClient; user: string }> {
        const { url, email, password } = this.options;
        const stored = await this.options.loadKey();
        // the port may have changed since: the key belongs to the server, not to its address
        if (stored?.secret && (!email || sameEmail(email, stored.email))) {
            const client = new ImmichClient(url, stored.secret, this.fetchFn);
            try {
                await client.albums();
                if (stored.url !== url) {
                    await this.options.saveKey({ ...stored, url });
                }
                return { client, user: stored.email };
            } catch (e) {
                if (!(e instanceof ImmichError) || (e.status !== 401 && e.status !== 403)) {
                    throw e;
                }
                this.options.log.info(
                    'Immich in Docker: the key of ioBroker is not accepted any more; a new one is made',
                );
            }
        }
        if (!email.trim() || !password) {
            throw new SetupStop({ state: 'noAccount' });
        }
        return { client: await this.createKey(stored), user: email.trim() };
    }

    private async createKey(previous: ImmichKey | null): Promise<ImmichClient> {
        const { url, password, keyName, log } = this.options;
        const email = this.options.email.trim();
        const config = await this.call<{ isInitialized?: boolean }>('GET', '/server/config');
        if (config.isInitialized === false) {
            try {
                await this.call('POST', '/auth/admin-sign-up', {
                    email,
                    password,
                    name: email.split('@')[0] || 'ioBroker',
                });
                log.info(`Immich in Docker: created the account ${email} (administrator)`);
            } catch (e) {
                // an administrator was created in between, e.g. in the browser: sign in below
                if (!(e instanceof ImmichError) || e.status !== 400) {
                    throw e;
                }
            }
        }
        let token: string;
        try {
            const login = await this.call<{ accessToken?: string }>('POST', '/auth/login', { email, password });
            if (!login.accessToken) {
                throw new ImmichError('Immich gave no access token');
            }
            token = login.accessToken;
        } catch (e) {
            if (e instanceof ImmichError && (e.status === 400 || e.status === 401)) {
                log.warn(`Immich in Docker: e-mail or password are not accepted (${e.message})`);
                throw new SetupStop({ state: 'loginFailed' });
            }
            throw e;
        }
        try {
            const key = await this.call<{ id?: string; secret?: string; apiKey?: { id?: string } }>(
                'POST',
                '/api-keys',
                { name: keyName, permissions: IMMICH_KEY_PERMISSIONS },
                token,
            );
            if (!key.secret) {
                throw new ImmichError('Immich made no API key');
            }
            const keyId = key.id || key.apiKey?.id || '';
            if (previous?.keyId && previous.keyId !== keyId) {
                // the old key does not work any more or belongs to another account: no reason to keep it
                await this.call('DELETE', `/api-keys/${encodeURIComponent(previous.keyId)}`, undefined, token).catch(
                    () => undefined,
                );
            }
            await this.options.saveKey({ url, email, keyId, secret: key.secret });
            log.info(`Immich in Docker: connected as ${email}`);
            return new ImmichClient(url, key.secret, this.fetchFn);
        } finally {
            await this.call('POST', '/auth/logout', undefined, token).catch(() => undefined);
        }
    }
}

export type Words = (key: string, ...args: string[]) => string;

/**
 * A path as one word of a shell command
 *
 * @param path - the path
 */
export function shellQuote(path: string): string {
    return /^[\w./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * The status for the settings of the instance (a `state` control with `html`)
 *
 * @param status - of Immich in Docker
 * @param word - the words
 * @param addresses - where the app and the browser reach the server (`appAddresses`)
 */
export function immichStatusHtml(status: ImmichDockerStatus, word: Words, addresses: string[]): string {
    let text: string;
    switch (status.state) {
        case 'noFolder':
            return escapeHtml(word('immich_status_no_folder'));
        case 'folderMissing':
            // the command to copy, on a line of its own
            return `${escapeHtml(word('immich_status_folder_missing', status.folder))}<br><code>sudo mkdir -p ${escapeHtml(shellQuote(status.folder))}</code>`;
        case 'starting':
            text = escapeHtml(word('immich_status_starting'));
            break;
        case 'noAccount':
            text = escapeHtml(word('immich_status_no_account'));
            break;
        case 'loginFailed':
            text = escapeHtml(word('immich_status_login_failed'));
            break;
        case 'ready':
            text = escapeHtml(word('immich_status_ready', status.user));
            break;
        case 'error':
            text = escapeHtml(word('immich_status_error', status.message));
            break;
    }
    if (status.state === 'starting') {
        return text;
    }
    if (!addresses.length) {
        return `${text}<br>${escapeHtml(word('immich_status_local_only'))}`;
    }
    const app = escapeHtml(word('immich_status_app', '\u0000')).replace(
        '\u0000',
        addresses.map(address => `<b>${escapeHtml(address)}</b>`).join(', '),
    );
    return `${text} ${link(addresses[0], word('immich_status_open'), true)}<br>${app}`;
}
