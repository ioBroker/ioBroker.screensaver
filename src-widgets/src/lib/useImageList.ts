import React from 'react';

import type { Connection } from '@iobroker/gui-components';

import { askAdapter, listRequest, toPhotoRefs, type AdapterSocket, type ListAnswer } from './adapterAlbum';
import type { FrameConfig } from './config';
import {
    FILES_URL,
    listStorageFolder,
    parseStateList,
    parseStorageFolder,
    parseUrlList,
    sameList,
    type DirEntry,
    type PhotoRef,
} from './sources';

export interface ImageList {
    photos: PhotoRef[];
    /**
     * Why there are none: a translation key, with the folder or album as argument. `folder_unsupported`: the page
     * gave a connection that cannot read folders (a host of web components may pass less than vis-2 does).
     * `album_*`: the album of the adapter is not configured, cannot be read, or the instance does not answer
     */
    error: ListError | null;
    /** With `album_failed`: why, in the words of the adapter (like `Immich has no album "x"`) */
    reason?: string;
    /** The folder is being read for the first time */
    loading: boolean;
    /** Read the folder again; does nothing more than once a minute */
    reload: () => void;
}

export type ListError =
    'folder_not_found' | 'folder_unsupported' | 'album_not_found' | 'album_failed' | 'album_unreachable';

/** Where the files of the project lie: the URL for the browser and the folder in the file storage */
export interface ProjectLocation {
    /** Like `../vis-2.0/main` */
    url: string;
    /** Like `vis-2.0/main` */
    folder: string;
    /** Where the web server serves the file storage, seen from the page; `../` if missing (vis-2) */
    files?: string;
}

/**
 * Can this connection read folders? vis-2 always passes one that can; a host of web components is only bound to
 * pass the methods of `WebComponentSocket`, which has no `readDir`.
 *
 * @param socket - the connection
 */
function canReadFolders(socket: Connection): boolean {
    return typeof socket.readDir === 'function' && typeof socket.subscribeFiles === 'function';
}

/** A safety net under the file subscription: some installations do not report new files */
const REREAD_EVERY_MS = 15 * 60 * 1000;

/** While the adapter reads an album for the first time, its list grows: ask again after this */
const SCANNING_AGAIN_MS = 30 * 1000;

/**
 * Milliseconds to the next midnight of this page, and a little: a date filter shows other pictures then
 *
 * @param now - now
 */
function untilMidnight(now = new Date()): number {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    return Math.max(1000, next.getTime() - now.getTime());
}

/** Not more often than this when the slideshow went round */
const RELOAD_THROTTLE_MS = 60 * 1000;

/** New files arrive in bursts when a whole album is uploaded */
const CHANGE_DEBOUNCE_MS = 2000;

const EMPTY: PhotoRef[] = [];

/** What was read of a folder, and which folder it was */
interface FolderResult {
    key: string;
    photos: PhotoRef[];
    error: ImageList['error'];
    reason?: string;
}

const NO_RESULT: FolderResult = { key: '', photos: EMPTY, error: null };

/**
 * The pictures of a frame, from whichever source it is set to.
 *
 * @param config - the settings of the frame
 * @param socket - the connection, to read the folder
 * @param project - where the files of the project lie, for `_PRJ_NAME`
 * @param listValue - the value of the list state
 * @param album - the value of the album state: a folder that replaces the one of the settings
 */
export function useImageList(
    config: FrameConfig,
    socket: Connection | null | undefined,
    project: ProjectLocation,
    listValue: unknown,
    album: unknown,
): ImageList {
    // the result carries the folder it belongs to: a result of the folder before is no result for this one
    const [result, setResult] = React.useState<FolderResult>(NO_RESULT);
    const [albumResult, setAlbumResult] = React.useState<FolderResult>(NO_RESULT);
    const reloadRef = React.useRef<() => void>(() => undefined);
    const lastReload = React.useRef(0);

    const albumFolder = typeof album === 'string' ? album.trim() : '';
    const folderText = config.source === 'folder' ? albumFolder || config.folder : '';
    const recursive = config.recursive;
    const parsed = parseStorageFolder(folderText, project.folder);
    const files = project.files || FILES_URL;
    const folderKey = socket && parsed ? `${parsed.namespace}/${parsed.path}|${recursive ? 1 : 0}|${files}` : '';
    const unsupported = !!socket && !!parsed && !canReadFolders(socket);

    // an album of the adapter: the album state wins over the album of the settings, as for a folder
    const adapterAlbum = config.source === 'adapter' ? albumFolder || config.album : '';
    const requestText = adapterAlbum ? JSON.stringify(listRequest(config, adapterAlbum)) : '';
    const instance = config.instance;
    const albumKey = socket && requestText ? `${instance}|${requestText}|${files}` : '';

    React.useEffect(() => {
        const adapterSocket = socket as unknown as AdapterSocket | null | undefined;
        if (!adapterSocket || !albumKey || typeof adapterSocket.sendTo !== 'function') {
            return undefined;
        }
        const request = JSON.parse(requestText) as { album: string };
        let alive = true;
        let again: ReturnType<typeof setTimeout> | null = null;
        let midnight: ReturnType<typeof setTimeout> | null = null;

        const read = async (): Promise<void> => {
            if (again) {
                clearTimeout(again);
                again = null;
            }
            try {
                const answer = await askAdapter<ListAnswer>(adapterSocket, instance, 'list', request);
                if (!alive) {
                    return;
                }
                if (!answer || answer.error || !Array.isArray(answer.pictures)) {
                    const error: ListError = answer?.error === 'album_not_found' ? 'album_not_found' : 'album_failed';
                    const reason = typeof answer?.reason === 'string' ? answer.reason : undefined;
                    setAlbumResult({ key: albumKey, photos: EMPTY, error, reason });
                    return;
                }
                const photos = toPhotoRefs(answer.pictures, adapterSocket, instance, request.album, files);
                setAlbumResult(old =>
                    old.key === albumKey && !old.error && sameList(old.photos, photos)
                        ? old
                        : { key: albumKey, photos, error: null },
                );
                if (answer.scanning) {
                    again = setTimeout(() => void read(), SCANNING_AGAIN_MS);
                }
            } catch {
                if (alive) {
                    setAlbumResult({ key: albumKey, photos: EMPTY, error: 'album_unreachable' });
                }
            }
        };

        const atMidnight = (): void => {
            midnight = setTimeout(() => {
                void read();
                atMidnight();
            }, untilMidnight());
        };

        void read();
        atMidnight();
        lastReload.current = Date.now();
        reloadRef.current = () => {
            if (Date.now() - lastReload.current > RELOAD_THROTTLE_MS) {
                lastReload.current = Date.now();
                void read();
            }
        };
        const interval = setInterval(() => void read(), REREAD_EVERY_MS);

        return () => {
            alive = false;
            reloadRef.current = () => undefined;
            clearInterval(interval);
            if (again) {
                clearTimeout(again);
            }
            if (midnight) {
                clearTimeout(midnight);
            }
        };
    }, [socket, albumKey, requestText, instance, files]);

    React.useEffect(() => {
        const folder = parseStorageFolder(folderText, project.folder);
        if (!socket || !folder || !folderKey || !canReadFolders(socket)) {
            return undefined;
        }
        let alive = true;
        let debounce: ReturnType<typeof setTimeout> | null = null;
        const readDir = (namespace: string, path: string): Promise<DirEntry[]> => socket.readDir(namespace, path);

        const read = async (): Promise<void> => {
            try {
                const photos = await listStorageFolder(readDir, folder, recursive, files);
                if (alive) {
                    setResult(old =>
                        old.key === folderKey && !old.error && sameList(old.photos, photos)
                            ? old
                            : { key: folderKey, photos, error: null },
                    );
                }
            } catch {
                if (alive) {
                    setResult({ key: folderKey, photos: EMPTY, error: 'folder_not_found' });
                }
            }
        };

        const onFileChange = (): void => {
            if (debounce) {
                clearTimeout(debounce);
            }
            debounce = setTimeout(() => {
                debounce = null;
                void read();
            }, CHANGE_DEBOUNCE_MS);
        };

        void read();
        lastReload.current = Date.now();
        reloadRef.current = () => {
            if (Date.now() - lastReload.current > RELOAD_THROTTLE_MS) {
                lastReload.current = Date.now();
                void read();
            }
        };

        // `*` of a file pattern also matches the slashes of subfolders
        const pattern = folder.path ? `${folder.path}/*` : '*';
        let subscribed = false;
        socket
            .subscribeFiles(folder.namespace, pattern, onFileChange)
            .then(() => (subscribed = true))
            .catch(() => undefined);
        const interval = setInterval(() => void read(), REREAD_EVERY_MS);

        return () => {
            alive = false;
            reloadRef.current = () => undefined;
            clearInterval(interval);
            if (debounce) {
                clearTimeout(debounce);
            }
            if (subscribed) {
                socket.unsubscribeFiles(folder.namespace, pattern, onFileChange);
            }
        };
    }, [socket, folderKey, folderText, recursive, project.folder, files]);

    const listPhotos = React.useMemo(
        () => (config.source === 'list' ? parseUrlList(config.urls, project.url, files) : EMPTY),
        [config.source, config.urls, project.url, files],
    );

    // A state value is text: written again with the same list, it is the same string, and the memo keeps the list
    const statePhotos = React.useMemo(
        () => (config.source === 'state' ? parseStateList(listValue, project.url, files) : EMPTY),
        [config.source, listValue, project.url, files],
    );

    const reload = React.useCallback(() => reloadRef.current(), []);

    if (config.source === 'list') {
        return { photos: listPhotos, error: null, loading: false, reload };
    }
    if (config.source === 'state') {
        return { photos: statePhotos, error: null, loading: false, reload };
    }
    if (config.source === 'adapter') {
        const current = albumKey && albumResult.key === albumKey ? albumResult : null;
        return {
            photos: current ? current.photos : EMPTY,
            error: current ? current.error : null,
            reason: current?.reason,
            loading: !!albumKey && !current,
            reload,
        };
    }
    if (unsupported) {
        return { photos: EMPTY, error: 'folder_unsupported', loading: false, reload };
    }
    const current = folderKey && result.key === folderKey ? result : null;
    return {
        photos: current ? current.photos : EMPTY,
        error: current ? current.error : null,
        // read for the first time
        loading: !!folderKey && !current,
        reload,
    };
}
