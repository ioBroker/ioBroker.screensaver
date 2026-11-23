/**
 * The backend of the photo frame and the screensaver: albums from folders and from Immich, filtered by date, and
 * the pictures reduced to the size of the frame.
 *
 * The widgets ask with `sendTo`:
 * - `getAlbums` → `[{ value, label }]`, the albums for the select of a widget
 * - `list` `{ album, filter, fallback, limit }` → the pictures of the album that are shown today
 * - `picture` `{ album, key, width, height }` → `{ url }`, a reduced copy in the file storage of the instance
 * - `rescan` `{ album? }` → read the albums again
 * - `testImmich` `{ url, apiKey }` → `{ result }` or `{ error }`, the button of the settings
 * - `googleConnect`, `googleSettings`, `googleDisconnect` → the buttons of Google Photos in the settings
 * - `checkFolder` `{ folder }` → the check of the folder of Immich in Docker below its field in the settings
 * - `weatherSources` → `[{ value, label }]`, the channels of the weather adapters for the settings of the web components
 *
 * With Immich the quick access of admin gets a card that opens it (`common.localLinks`, `immichLink.ts`).
 *
 * Immich can run in Docker on this host (`docker-compose.yaml`, started by `@iobroker/plugin-docker`): the adapter
 * then creates the folder of the photos, lets the plugin start the containers and connects itself (`immichDocker.ts`).
 */

import * as utils from '@iobroker/adapter-core';
import { existsSync, readFileSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { IndexStore } from './lib/albumIndex';
import { Albums } from './lib/albums';
import { GoogleConnection, statusHtml, type GoogleAccount, type GoogleStatus } from './lib/googleConnection';
import { GOOGLE_MEDIA_MAX_AGE_MS, OAuthProxy } from './lib/googlePhotos';
import { ImmichClient } from './lib/immich';
import {
    appAddresses,
    ImmichDocker,
    immichStatusHtml,
    readDockerSettings,
    serverUrl,
    shellQuote,
    type ImmichDockerSettings,
    type ImmichDockerStatus,
    type ImmichKey,
} from './lib/immichDocker';
import { IMMICH_LINK_KEY, immichLink, withImmichLink } from './lib/immichLink';
import { checkFolder, folderCheckAnswer } from './lib/photoFolder';
import { PictureCache, type CacheStorage, type SharpFactory } from './lib/pictureCache';
import { parseStorageLocation, type FileStorage } from './lib/sources';
import type { Picture, ScreensaverAdapterConfig } from './lib/types';
import { listWeatherSources, type ObjectMap } from '../src-widgets/src/lib/weatherSource';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace ioBroker {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface AdapterConfig extends ScreensaverAdapterConfig {}
    }
}

const MB = 1024 * 1024;

/** Copies older than their album allows (Google Photos: 60 minutes) are looked for this often */
const EXPIRE_EVERY_MS = 5 * 60_000;

/** New files arrive in bursts when a whole folder is uploaded */
const FILE_CHANGE_DEBOUNCE_MS = 5000;

/** The index of an album in the data folder of the instance */
const INDEX_VERSION = 1;

/** The object whose `native` keeps the account of Google Photos; the refresh token encrypted */
const GOOGLE_OBJECT = 'google';
/** The channel of Immich in Docker; its native keeps the API key of the adapter */
const IMMICH_OBJECT = 'immich';

/**
 * sharp, if it is installed and works on this host; without it, files of the storage are shown as they are and
 * other files are copied as they are
 */
function loadSharp(): SharpFactory | null {
    try {
        return require('sharp') as SharpFactory;
    } catch {
        return null;
    }
}

/**
 * A text of an error
 *
 * @param e - what was thrown
 */
function errorText(e: unknown): string {
    return e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
}

class ScreensaverAdapter extends utils.Adapter {
    private albums: Albums | null = null;
    private cache: PictureCache | null = null;
    private rescanTimer: ioBroker.Interval | undefined;
    private readonly changeTimers = new Map<string, ioBroker.Timeout | undefined>();
    /** The folders of the storage that are watched: `[namespace, pattern]` */
    private readonly watched: [string, string][] = [];
    private scanChain: Promise<void> = Promise.resolve();
    private google: GoogleConnection | null = null;
    private immichDocker: ImmichDocker | null = null;
    private googleState = '';
    private words: Record<string, string> = {};
    private lang: ioBroker.Languages = 'en';

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'screensaver' });
        this.on('ready', () => this.onReady());
        this.on('message', obj => void this.onMessage(obj));
        this.on('fileChange', (id, fileName) => this.onFileChange(id, fileName));
        this.on('unload', callback => this.onUnload(callback));
    }

    private fileStorage(): FileStorage {
        const filesDir = join(utils.getAbsoluteDefaultDataDir(), 'files');
        return {
            readDir: async (namespace, path) => {
                const entries = await this.readDirAsync(namespace, path);
                return entries.map(entry => ({
                    file: entry.file,
                    isDir: !!entry.isDir,
                    size: entry.stats?.size,
                    modified: entry.modifiedAt,
                }));
            },
            readFile: async (namespace, path) => {
                const { file } = await this.readFileAsync(namespace, path);
                return Buffer.isBuffer(file) ? file : Buffer.from(file);
            },
            // the file storage of a single host keeps its files on the disk: the head of a photo is read from
            // there, not the whole photo through the database
            localPath: (namespace, path) => {
                const file = join(filesDir, namespace, ...path.split('/'));
                return existsSync(file) ? file : null;
            },
        };
    }

    private cacheStorage(): CacheStorage {
        const list = async (folder: string): Promise<{ path: string; size: number; time: number }[]> => {
            const result: { path: string; size: number; time: number }[] = [];
            let entries: ioBroker.ReadDirResult[];
            try {
                entries = await this.readDirAsync(this.namespace, folder);
            } catch {
                return result;
            }
            for (const entry of entries) {
                const path = `${folder}/${entry.file}`;
                if (entry.isDir) {
                    result.push(...(await list(path)));
                } else {
                    result.push({ path, size: entry.stats?.size || 0, time: entry.modifiedAt || 0 });
                }
            }
            return result;
        };
        return {
            write: (path, data) => this.writeFileAsync(this.namespace, path, data),
            delete: path => this.delFileAsync(this.namespace, path),
            list,
        };
    }

    private indexStore(): IndexStore {
        const dir = join(utils.getAbsoluteInstanceDataDir(this), 'index');
        return {
            load: async albumId => {
                const text = await fs.readFile(join(dir, `${albumId}.json`), 'utf8');
                const stored = JSON.parse(text) as { version?: number; pictures?: Picture[] };
                return stored.version === INDEX_VERSION && Array.isArray(stored.pictures) ? stored.pictures : null;
            },
            save: async (albumId, pictures) => {
                await fs.mkdir(dir, { recursive: true });
                const file = join(dir, `${albumId}.json`);
                await fs.writeFile(`${file}.tmp`, JSON.stringify({ version: INDEX_VERSION, pictures }));
                await fs.rename(`${file}.tmp`, file);
            },
            remove: async albumId => {
                await fs.rm(join(dir, `${albumId}.json`), { force: true });
            },
        };
    }

    /**
     * The card of Immich in the quick access of admin: there while Immich is set up. js-controller restarts the
     * instance when its object changes, so it is written only when the card changes.
     *
     * @param config - the settings of the instance
     */
    private async updateImmichLink(config: ScreensaverAdapterConfig): Promise<void> {
        const id = `system.adapter.${this.namespace}`;
        try {
            const obj = await this.getForeignObjectAsync(id);
            if (!obj?.common) {
                return;
            }
            const common = obj.common as ioBroker.InstanceCommon;
            const link = immichLink(readDockerSettings(config.dockerImmich), config.immichUrl);
            const links = withImmichLink(common.localLinks, link);
            if (isDeepStrictEqual(links, common.localLinks)) {
                return;
            }
            if (links) {
                common.localLinks = links;
            } else {
                delete common.localLinks;
            }
            this.log.info(
                links?.[IMMICH_LINK_KEY]
                    ? `The quick access of admin gets a card for Immich (${link}); the instance restarts once`
                    : 'The card for Immich leaves the quick access of admin; the instance restarts once',
            );
            await this.setForeignObjectAsync(id, obj);
        } catch (e) {
            this.log.warn(`Cannot update the card for Immich in admin: ${errorText(e)}`);
        }
    }

    private async onReady(): Promise<void> {
        const config = this.config;
        const sharp = loadSharp();
        if (!sharp) {
            this.log.warn('sharp is not available on this host: pictures are not reduced');
        }

        await this.loadWords();
        await this.updateImmichLink(config);

        let immich: ImmichClient | (() => ImmichClient) | null = null;
        const immichDocker = await this.startImmichDocker(readDockerSettings(config.dockerImmich));
        if (immichDocker) {
            this.immichDocker = immichDocker;
            immich = () => immichDocker.client();
        } else if (config.immichUrl?.trim() && config.immichApiKey?.trim()) {
            try {
                immich = new ImmichClient(config.immichUrl, config.immichApiKey);
            } catch (e) {
                this.log.warn(errorText(e));
            }
        }

        this.cache = new PictureCache(
            this.cacheStorage(),
            this.namespace,
            sharp,
            Math.max(20, Number(config.cacheSizeMb) || 500) * MB,
        );
        await this.cache.init();

        const google = await this.startGoogle();
        this.google = google;

        this.albums = new Albums({
            storage: this.fileStorage(),
            immich,
            google,
            store: this.indexStore(),
            cache: this.cache,
            log: this.log,
            maxEdge: Number(config.maxEdge) || 2560,
        });
        for (const problem of this.albums.configure(config.albums || [])) {
            this.log.warn(problem);
        }
        await this.cache.forgetOthers(this.albums.ids);
        // Google Photos allows its media to be cached for 60 minutes only
        for (const index of this.albums.all()) {
            this.cache.setMaxAge(index.config.id, index.config.type === 'google' ? GOOGLE_MEDIA_MAX_AGE_MS : null);
        }
        await this.cache.expire();
        this.setInterval(() => void this.cache?.expire(), EXPIRE_EVERY_MS);
        if (!this.albums.ids.length) {
            this.log.info('No album is configured yet: add one in the settings of the instance');
        }

        // the folders of the storage tell when files change
        for (const index of this.albums.all()) {
            if (index.config.type !== 'storage') {
                continue;
            }
            const folder = parseStorageLocation(index.config.location);
            if (folder) {
                const pattern = folder.path ? `${folder.path}/*` : '*';
                try {
                    await this.subscribeForeignFilesAsync(folder.namespace, pattern);
                    this.watched.push([folder.namespace, pattern]);
                } catch (e) {
                    this.log.debug(`Changes of ${folder.namespace}/${pattern} are not reported: ${errorText(e)}`);
                }
            }
        }

        this.scanAll();
        void google.start().catch(e => this.log.warn(`Google Photos: ${errorText(e)}`));
        void immichDocker?.start().catch(e => this.log.warn(`Immich in Docker: ${errorText(e)}`));
        const minutes = Math.max(5, Number(config.rescanMinutes) || 60);
        this.rescanTimer = this.setInterval(() => this.scanAll(), minutes * 60_000);
    }

    /** The words of the status texts, in the language of the system */
    private async loadWords(): Promise<void> {
        const system = await this.getForeignObjectAsync('system.config').catch(() => null);
        this.lang = (system?.common?.language as ioBroker.Languages) || 'en';
        const read = (lang: string): Record<string, string> => {
            try {
                const file = join(__dirname, '..', '..', 'admin', 'i18n', `${lang}.json`);
                return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
            } catch {
                return {};
            }
        };
        this.words = { ...read('en'), ...read(this.lang) };
    }

    private readonly word = (key: string, ...args: string[]): string => {
        let text = this.words[key] || key;
        for (const arg of args) {
            text = text.replace('%s', arg);
        }
        return text;
    };

    /**
     * Immich in Docker: the objects of its status, the folder of the photos, the start of the containers, and the
     * connection to the server
     *
     * @param docker - the settings
     * @returns the connection; null where Immich does not run in Docker
     */
    private async startImmichDocker(docker: ImmichDockerSettings): Promise<ImmichDocker | null> {
        await this.extendObjectAsync(IMMICH_OBJECT, { type: 'channel', common: { name: 'Immich in Docker' } });
        await this.extendObjectAsync(`${IMMICH_OBJECT}.connected`, {
            type: 'state',
            common: {
                name: 'Connected',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
        await this.extendObjectAsync(`${IMMICH_OBJECT}.status`, {
            type: 'state',
            common: {
                name: 'Status for the settings',
                type: 'string',
                role: 'html',
                read: true,
                write: false,
                def: '',
            },
            native: {},
        });
        const show = (status: ImmichDockerStatus): void => {
            void this.setStateChangedAsync(`${IMMICH_OBJECT}.connected`, status.state === 'ready', true);
            void this.setStateChangedAsync(
                `${IMMICH_OBJECT}.status`,
                immichStatusHtml(status, this.word, appAddresses(docker)),
                true,
            );
        };

        if (!docker.enabled) {
            await this.setStateChangedAsync(`${IMMICH_OBJECT}.connected`, false, true);
            await this.setStateChangedAsync(`${IMMICH_OBJECT}.status`, '', true);
            if (docker.machineLearning) {
                // the settings uncheck it together with Docker; else its container would run on alone. This
                // restarts the instance, and the plugin stops the container.
                this.log.info('Immich in Docker is off: machine learning is switched off as well');
                await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                    native: { dockerImmich: { machineLearning: false } },
                });
            }
            return null;
        }

        // a path that does not start with "/" would be taken by the plugin for the name of a Docker volume
        if (!docker.location.startsWith('/')) {
            this.log.error(
                `Immich in Docker: ${docker.location ? `"${docker.location}" is not a full path` : 'no folder for the photos'}; choose one in the settings. The containers are not started`,
            );
            show({ state: 'noFolder' });
            return null;
        }
        try {
            await fs.mkdir(docker.location, { recursive: true });
        } catch (e) {
            // Docker does not create the source of a bind mount: without the folder the server cannot start
            const check = await checkFolder(docker.location);
            if (check.state === 'cannotCheck') {
                // a folder above is closed to ioBroker, but Docker looks as root: it may well be there
                this.log.warn(
                    `Immich in Docker: ioBroker may not look into ${docker.location} (${errorText(e)}); the containers are started anyway`,
                );
            } else if (check.state !== 'exists') {
                this.log.error(
                    `Immich in Docker: cannot create the folder ${docker.location} (${errorText(e)}). Create it on the host (sudo mkdir -p ${shellQuote(docker.location)}) and restart the instance. The containers are not started`,
                );
                show({ state: 'folderMissing', folder: docker.location });
                return null;
            }
        }
        // the containers wait for this (iobWaitForReady): the folder exists now. The plugin resolves only when the
        // images are pulled and the containers run - minutes on the first start, a check for newer images on every
        // start - so it runs aside: the albums must not wait for it, and ImmichDocker waits for the server itself
        const plugin = this.getPluginInstance('docker') as unknown as {
            instanceIsReady?: (force?: boolean) => Promise<void>;
        } | null;
        if (typeof plugin?.instanceIsReady === 'function') {
            void plugin.instanceIsReady().then(
                () => this.log.debug('Immich in Docker: the containers are checked'),
                e => this.log.warn(`Immich in Docker: the containers cannot be started (${errorText(e)})`),
            );
        } else {
            this.log.warn('Immich in Docker: the Docker plugin is not loaded, the containers are not started');
        }

        return new ImmichDocker({
            url: serverUrl(docker),
            email: this.config.immichEmail || '',
            password: this.config.immichPassword || '',
            keyName: `ioBroker ${this.namespace}`,
            loadKey: () => this.loadImmichKey(),
            saveKey: key => this.saveImmichKey(key),
            onStatus: show,
            onReady: () => this.scanImmich(),
            log: this.log,
        });
    }

    private async loadImmichKey(): Promise<ImmichKey | null> {
        const obj = await this.getObjectAsync(IMMICH_OBJECT);
        const stored = obj?.native?.key as ImmichKey | null | undefined;
        if (!stored?.secret) {
            return null;
        }
        try {
            return { ...stored, secret: this.decrypt(stored.secret) };
        } catch {
            return null;
        }
    }

    private async saveImmichKey(key: ImmichKey): Promise<void> {
        await this.extendObjectAsync(IMMICH_OBJECT, { native: { key: { ...key, secret: this.encrypt(key.secret) } } });
    }

    /** Read the albums of Immich: its server in Docker is ready now */
    private scanImmich(): void {
        for (const index of this.albums?.all() || []) {
            if (index.config.type === 'immich') {
                this.queueScan(index.config.id);
            }
        }
    }

    /** The objects of the connection, and the connection with the stored account */
    private async startGoogle(): Promise<GoogleConnection> {
        await this.extendObjectAsync(GOOGLE_OBJECT, {
            type: 'channel',
            common: { name: 'Google Photos' },
        });
        const states: [string, ioBroker.StateCommon][] = [
            [
                'connected',
                {
                    name: 'Connected',
                    type: 'boolean',
                    role: 'indicator.connected',
                    read: true,
                    write: false,
                    def: false,
                },
            ],
            [
                'state',
                {
                    name: 'State of the connection',
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                    def: 'disconnected',
                    states: {
                        disconnected: 'disconnected',
                        code: 'waiting for the code',
                        sources: 'waiting for the choice in the app',
                        connected: 'connected',
                        expired: 'sign-in expired',
                        gone: 'device removed in the app',
                        denied: 'sign-in not completed',
                        notAllowed: 'not allowed by Google (partner program)',
                        error: 'error',
                    },
                },
            ],
            [
                'status',
                { name: 'Status for the settings', type: 'string', role: 'html', read: true, write: false, def: '' },
            ],
        ];
        for (const [id, common] of states) {
            await this.extendObjectAsync(`${GOOGLE_OBJECT}.${id}`, { type: 'state', common, native: {} });
        }

        return new GoogleConnection({
            oauth: new OAuthProxy(),
            // the name the user finds the device under in the Google Photos app
            displayName: this.config.googleDeviceName?.trim() || `ioBroker ${this.host || ''}`.trim(),
            loadAccount: () => this.loadGoogleAccount(),
            saveAccount: account => this.saveGoogleAccount(account),
            onStatus: status => void this.showGoogleStatus(status),
            onSourcesChosen: () => this.scanGoogle(),
            log: this.log,
        });
    }

    private async loadGoogleAccount(): Promise<GoogleAccount | null> {
        const obj = await this.getObjectAsync(GOOGLE_OBJECT);
        const stored = obj?.native?.account as GoogleAccount | null | undefined;
        if (!stored?.refreshToken || !stored.deviceId) {
            return null;
        }
        try {
            return { ...stored, refreshToken: this.decrypt(stored.refreshToken) };
        } catch {
            this.log.warn('Google Photos: the stored sign-in cannot be read; connect again');
            return null;
        }
    }

    private async saveGoogleAccount(account: GoogleAccount | null): Promise<void> {
        await this.extendObjectAsync(GOOGLE_OBJECT, {
            native: { account: account ? { ...account, refreshToken: this.encrypt(account.refreshToken) } : null },
        });
    }

    private async showGoogleStatus(status: GoogleStatus): Promise<void> {
        const time = (ms: number): string =>
            new Date(ms).toLocaleTimeString(this.lang, { hour: '2-digit', minute: '2-digit' });
        const was = this.googleState;
        this.googleState = status.state;
        await this.setStateChangedAsync(`${GOOGLE_OBJECT}.state`, status.state, true);
        await this.setStateChangedAsync(`${GOOGLE_OBJECT}.connected`, status.state === 'connected', true);
        await this.setStateChangedAsync(`${GOOGLE_OBJECT}.status`, statusHtml(status, this.word, time), true);
        if (status.state === 'connected' && was !== 'connected') {
            this.scanGoogle();
        }
        if (status.state === 'disconnected' || status.state === 'expired' || status.state === 'gone') {
            // the access is withdrawn: nothing of Google Photos stays, neither the copies nor the list of the media
            for (const index of this.albums?.all() || []) {
                if (index.config.type === 'google') {
                    await this.cache?.forgetAlbum(index.config.id);
                    await index.forget();
                }
            }
        }
    }

    /** Read the albums of Google Photos: connected now, or other sources chosen */
    private scanGoogle(): void {
        for (const index of this.albums?.all() || []) {
            if (index.config.type === 'google') {
                this.queueScan(index.config.id);
            }
        }
    }

    /** `subscribeForeignFiles` as a promise: older controllers have it without */
    private subscribeForeignFilesAsync(namespace: string, pattern: string): Promise<void> {
        return Promise.resolve(this.subscribeForeignFiles(namespace, pattern));
    }

    /** Read the albums one after the other: the host is busy enough with one */
    private scanAll(): void {
        for (const index of this.albums?.all() || []) {
            // Immich in Docker reads its albums once it runs (scanImmich)
            if (index.config.type === 'immich' && this.immichDocker && !this.immichDocker.ready) {
                continue;
            }
            this.queueScan(index.config.id);
        }
    }

    private queueScan(albumId: string): void {
        this.scanChain = this.scanChain
            .then(async () => {
                const index = this.albums?.get(albumId);
                if (!index) {
                    return;
                }
                await this.setStateAsync('info.scanning', true, true);
                await index.scan();
            })
            .catch(e => this.log.warn(`Album "${albumId}": ${errorText(e)}`))
            .finally(() => this.updateInfo());
    }

    private async updateInfo(): Promise<void> {
        const pictures = (this.albums?.all() || []).reduce((sum, index) => sum + index.size, 0);
        const scanning = (this.albums?.all() || []).some(index => index.scanning);
        await this.setStateChangedAsync('info.pictures', pictures, true);
        await this.setStateChangedAsync('info.cacheMb', Math.round(((this.cache?.bytes || 0) / MB) * 10) / 10, true);
        await this.setStateChangedAsync('info.scanning', scanning, true);
    }

    private onFileChange(id: string, fileName: string): void {
        for (const index of this.albums?.all() || []) {
            if (index.config.type !== 'storage') {
                continue;
            }
            const folder = parseStorageLocation(index.config.location);
            const name = fileName.replace(/^\/+/, '');
            if (folder?.namespace === id && (!folder.path || name.startsWith(`${folder.path}/`))) {
                const albumId = index.config.id;
                this.clearTimeout(this.changeTimers.get(albumId));
                this.changeTimers.set(
                    albumId,
                    this.setTimeout(() => {
                        this.changeTimers.delete(albumId);
                        this.queueScan(albumId);
                    }, FILE_CHANGE_DEBOUNCE_MS),
                );
            }
        }
    }

    private async answer(obj: ioBroker.Message): Promise<unknown> {
        const albums = this.albums;
        switch (obj.command) {
            case 'getAlbums':
                return albums ? albums.selectOptions() : [];
            case 'weatherSources': {
                // the same rules as the select of the vis-2 editor, which reads the objects itself
                const sources = await listWeatherSources(async (type, start, end) => {
                    const view = await this.getObjectViewAsync('system', type as 'state', {
                        startkey: start,
                        endkey: end,
                    });
                    return Object.fromEntries(view.rows.map(row => [row.id, row.value as ObjectMap[string]]));
                });
                return [{ value: '', label: this.word('weather_source_none') }, ...sources];
            }
            case 'list':
                return albums ? albums.list(obj.message) : { error: 'album_not_found' };
            case 'picture': {
                const answer = albums ? await albums.picture(obj.message) : { error: 'album_not_found' as const };
                void this.updateInfo();
                return answer;
            }
            case 'rescan': {
                const id = (obj.message as { album?: string } | undefined)?.album;
                if (id) {
                    this.queueScan(id);
                } else {
                    this.scanAll();
                }
                return { result: 'ok' };
            }
            case 'testImmich':
                return this.testImmich(obj.message);
            case 'checkFolder': {
                // the control below the folder field of the settings, asked again on every change of the field
                const folder = (obj.message as { folder?: unknown } | null)?.folder;
                const path = typeof folder === 'string' ? folder : '';
                return folderCheckAnswer(await checkFolder(path), path, this.word);
            }
            case 'googleConnect':
                return this.googleConnect();
            case 'googleSettings': {
                const url = this.google?.settingsUri;
                return url ? { openUrl: url, window: '_blank' } : { error: this.word('google_not_connected') };
            }
            case 'googleDisconnect':
                if (this.google) {
                    await this.google.disconnect();
                    this.scanGoogle();
                }
                return { result: this.word('google_disconnected') };
            default:
                return { error: `Unknown command "${obj.command}"` };
        }
    }

    private async testImmich(message: unknown): Promise<{ result?: string; error?: string }> {
        const data = (message || {}) as { url?: string; apiKey?: string };
        const url = data.url?.trim() || this.config.immichUrl;
        const apiKey = data.apiKey?.trim() || this.config.immichApiKey;
        try {
            const client = new ImmichClient(url || '', apiKey || '');
            const albums = await client.albums();
            // the name needs the permission user.read, which a key that only reads pictures does not have
            const me = await client.me().catch(() => null);
            return {
                result: `Immich OK: ${me?.name || me?.email || 'user'}, ${albums.length} albums (${albums
                    .slice(0, 10)
                    .map(album => album.albumName)
                    .join(', ')}${albums.length > 10 ? ', …' : ''})`,
            };
        } catch (e) {
            return { error: errorText(e) };
        }
    }

    private async googleConnect(): Promise<{ result?: string; error?: string }> {
        if (!this.google) {
            return { error: 'not ready' };
        }
        try {
            const code = await this.google.connect();
            return { result: this.word('google_connect_result', code.userCode, code.verificationUrl) };
        } catch (e) {
            return { error: errorText(e) };
        }
    }

    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj || typeof obj !== 'object' || !obj.command) {
            return;
        }
        let answer: unknown;
        try {
            answer = await this.answer(obj);
        } catch (e) {
            this.log.warn(`Command "${obj.command}" failed: ${errorText(e)}`);
            answer = { error: errorText(e) };
        }
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, answer, obj.callback);
        }
    }

    private onUnload(callback: () => void): void {
        try {
            this.clearInterval(this.rescanTimer);
            this.google?.stop();
            this.immichDocker?.stop();
            for (const timer of this.changeTimers.values()) {
                this.clearTimeout(timer);
            }
            for (const [namespace, pattern] of this.watched) {
                void Promise.resolve(this.unsubscribeForeignFiles(namespace, pattern)).catch(() => undefined);
            }
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new ScreensaverAdapter(options);
} else {
    (() => new ScreensaverAdapter())();
}
