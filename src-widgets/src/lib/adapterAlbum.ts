/**
 * The pictures of an album of the screensaver adapter: the adapter reads folders and Immich, filters by date and
 * reduces the pictures; the widget asks it with `sendTo` and loads the reduced copies from the file storage.
 *
 * `list` gives the pictures of the album that are shown today, `picture` makes a copy of one in the size of the
 * frame and tells where it is - only when the slideshow is about to show it.
 */

import type { FrameConfig } from './config';
import { FILES_URL, type PhotoRef } from './sources';

/** What the widgets need of a connection: vis-2, devices and every host of web components have it */
export interface AdapterSocket {
    sendTo(instance: string, command: string, data?: unknown): Promise<unknown>;
}

/** An instance that does not answer in this time is not running */
export const ADAPTER_TIMEOUT_MS = 20_000;

/** A picture in the short form of `list` (see `src/lib/types.ts` of the adapter) */
export interface ListedPicture {
    k: string;
    d?: string;
    w?: number;
    h?: number;
    p?: string;
    c?: string;
}

export interface ListAnswer {
    pictures?: ListedPicture[];
    total?: number;
    matched?: number;
    fallback?: boolean;
    scanning?: boolean;
    error?: string;
    /** With `album_failed`: why, as the source said it */
    reason?: string;
}

/**
 * Ask the adapter, and give up when it does not answer: a stopped instance never does
 *
 * @param socket - the connection
 * @param instance - like `screensaver.0`
 * @param command - the command
 * @param data - the message
 * @param signal - stops waiting
 */
export function askAdapter<T>(
    socket: AdapterSocket,
    instance: string,
    command: string,
    data: unknown,
    signal?: AbortSignal,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ADAPTER_TIMEOUT_MS);
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        socket.sendTo(instance, command, data).then(
            answer => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                resolve(answer as T);
            },
            (e: unknown) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                reject(e instanceof Error ? e : new Error(String(e)));
            },
        );
    });
}

/**
 * What `list` is asked for
 *
 * @param config - the settings of the frame
 * @param album - the album: the one of the settings, or the value of the album state
 */
export function listRequest(config: FrameConfig, album: string): Record<string, unknown> {
    return {
        album,
        filter: {
            mode: config.dateFilter,
            days: config.days,
            from: config.dateFrom,
            to: config.dateTo,
            yearsAgo: config.yearsAgo,
            windowDays: config.windowDays,
        },
        fallback: config.filterFallback,
    };
}

/**
 * A wall-clock time of the adapter, `YYYY-MM-DDTHH:mm:ss`, as a date of this page: shown as it was written
 *
 * @param text - the time
 */
export function parseWallClock(text: string | undefined): Date | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text || '');
    if (!match) {
        return undefined;
    }
    const [, y, m, d, hh, mm, ss] = match.map(Number);
    return new Date(y, m - 1, d, hh, mm, ss);
}

/**
 * The URL of a file of the storage, every part encoded
 *
 * @param path - like `screensaver.0/cache/fotos/1a2b_1920.jpg`
 * @param filesUrl - where the web server serves the storage
 */
export function storageUrl(path: string, filesUrl = FILES_URL): string {
    return `${filesUrl}${path
        .split('/')
        .filter(Boolean)
        .map(part => encodeURIComponent(part))
        .join('/')}`;
}

/**
 * The pictures of an answer of `list` as the slideshow takes them
 *
 * @param pictures - the answer
 * @param socket - to ask for the copy of a picture when it is shown
 * @param instance - the instance
 * @param album - the album
 * @param filesUrl - where the web server serves the storage
 */
export function toPhotoRefs(
    pictures: ListedPicture[],
    socket: AdapterSocket,
    instance: string,
    album: string,
    filesUrl = FILES_URL,
): PhotoRef[] {
    return pictures
        .filter(picture => picture && typeof picture.k === 'string')
        .map(picture => {
            const ref: PhotoRef = {
                key: `${instance}/${album}/${picture.k}`,
                url: '',
                resolve: async (target, signal) => {
                    const answer = await askAdapter<{ url?: string; error?: string }>(
                        socket,
                        instance,
                        'picture',
                        { album, key: picture.k, width: target.width, height: target.height },
                        signal,
                    );
                    if (!answer?.url) {
                        throw new Error(answer?.error || 'picture_failed');
                    }
                    return storageUrl(answer.url, filesUrl);
                },
            };
            const date = parseWallClock(picture.d);
            if (date) {
                ref.date = date;
            }
            if (picture.p) {
                ref.place = picture.p;
            }
            if (picture.c) {
                ref.caption = picture.c;
            }
            return ref;
        });
}
