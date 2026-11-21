/**
 * Reduced copies of the pictures, in the file storage of the instance: `screensaver.0/cache/<album>/<hash>_<edge>.jpg`.
 *
 * The browser loads them like any file of the storage (web: `/screensaver.0/cache/…`, admin: `/files/…`), so a
 * tablet gets 300 KB instead of a 6 MB photo and never sees a key of Immich. The cache keeps the copies used last
 * and drops the oldest when it grows beyond its size.
 */

import { createHash } from 'node:crypto';

import { BROWSER_FILE, type PictureSource } from './sources';
import type { Picture } from './types';

/** The longest edges a copy is made with: a frame of any size takes the next larger one */
export const EDGES = [960, 1280, 1920, 2560, 3840];

/** Folder of the copies in the storage of the instance */
export const CACHE_FOLDER = 'cache';

/** A file of the source this small is shown as it is (a storage folder only) */
const SMALL_ENOUGH_BYTES = 1.5 * 1024 * 1024;

/** The part of sharp that is used; sharp is loaded when it is there and works on this host */
export type SharpFactory = (
    input: Buffer,
    options?: { failOn?: 'none' | 'truncated' | 'error' | 'warning' },
) => {
    rotate(): ReturnType<SharpFactory>;
    resize(
        width: number,
        height: number,
        options: { fit: 'inside'; withoutEnlargement: boolean },
    ): ReturnType<SharpFactory>;
    keepExif(): ReturnType<SharpFactory>;
    jpeg(options: { quality: number; progressive?: boolean }): ReturnType<SharpFactory>;
    toBuffer(): Promise<Buffer>;
};

/** What the cache needs of the storage */
export interface CacheStorage {
    write(path: string, data: Buffer): Promise<void>;
    delete(path: string): Promise<void>;
    /** All files below a folder, with their size and time */
    list(folder: string): Promise<{ path: string; size: number; time: number }[]>;
}

/**
 * The edge a copy is made with for a frame of this size
 *
 * @param width - the frame, device pixels
 * @param height - the frame, device pixels
 * @param maxEdge - the largest edge the instance allows
 */
export function edgeFor(width: number, height: number, maxEdge: number): number {
    const wanted = Math.max(1, Number(width) || 0, Number(height) || 0);
    const allowed = EDGES.filter(edge => edge <= Math.max(EDGES[0], maxEdge));
    return allowed.find(edge => edge >= wanted) || allowed[allowed.length - 1];
}

/**
 * The file name of a copy: changes when the picture changes
 *
 * @param albumId - the album
 * @param picture - the picture
 * @param edge - the edge
 * @param ext - `jpg`, or the extension of a file taken as it is
 */
export function cachePath(albumId: string, picture: Picture, edge: number, ext = 'jpg'): string {
    const hash = createHash('sha1')
        .update(`${picture.key}|${picture.size ?? ''}|${picture.version ?? ''}`)
        .digest('hex')
        .substring(0, 20);
    return `${CACHE_FOLDER}/${albumId}/${hash}_${edge}.${ext}`;
}

/**
 * The extension of a file that is kept as it is
 *
 * @param name - the file name
 */
function extensionOf(name: string): string {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

/**
 * Pictures a reduction would spoil: an animated GIF stays a GIF, and a PNG may have transparent parts
 *
 * @param name - the file name
 */
function keepAsItIs(name: string): boolean {
    return /\.(gif|png|svg)$/i.test(name);
}

export class PictureCache {
    /** The copies there are, by path, and when they were used */
    private readonly files = new Map<string, { size: number; used: number }>();
    private total = 0;
    private readonly pending = new Map<string, Promise<string>>();

    constructor(
        private readonly storage: CacheStorage,
        private readonly namespace: string,
        private readonly sharp: SharpFactory | null,
        private limitBytes: number,
        private readonly now: () => number = Date.now,
    ) {}

    /** The copies left from before; the oldest are dropped if the cache got smaller */
    async init(): Promise<void> {
        let existing: { path: string; size: number; time: number }[] = [];
        try {
            existing = await this.storage.list(CACHE_FOLDER);
        } catch {
            // no cache yet
        }
        for (const file of existing) {
            this.files.set(file.path, { size: file.size, used: file.time });
            this.total += file.size;
        }
        await this.trim();
    }

    get bytes(): number {
        return this.total;
    }

    setLimit(bytes: number): void {
        this.limitBytes = bytes;
    }

    /**
     * Where the browser gets a picture: a copy reduced to `edge`, made when there is none
     *
     * @param albumId - the album
     * @param picture - the picture
     * @param source - where the file comes from
     * @param edge - the longest edge it is shown with
     * @returns the path of the file below the file storage, like `screensaver.0/cache/fotos/1a2b_1920.jpg`
     */
    async get(albumId: string, picture: Picture, source: PictureSource, edge: number): Promise<string> {
        // a small file of the storage the browser may load as it is: no copy
        if (
            source.storagePath &&
            BROWSER_FILE.test(picture.name) &&
            (keepAsItIs(picture.name) ||
                !this.sharp ||
                ((picture.size || Infinity) < SMALL_ENOUGH_BYTES &&
                    Math.max(picture.width || Infinity, picture.height || Infinity) <= edge))
        ) {
            return source.storagePath(picture.key);
        }

        const reduce = !!this.sharp && !keepAsItIs(picture.name);
        const path = cachePath(albumId, picture, edge, reduce ? 'jpg' : extensionOf(picture.name));
        const known = this.files.get(path);
        if (known) {
            known.used = this.now();
            return `${this.namespace}/${path}`;
        }
        let job = this.pending.get(path);
        if (job === undefined) {
            job = this.make(path, picture, source, edge, reduce).finally(() => this.pending.delete(path));
            this.pending.set(path, job);
        }
        return job;
    }

    private async make(
        path: string,
        picture: Picture,
        source: PictureSource,
        edge: number,
        reduce: boolean,
    ): Promise<string> {
        const original = await source.read(picture.key, edge);
        let data = original;
        if (reduce && this.sharp) {
            try {
                data = await this.sharp(original, { failOn: 'none' })
                    // turned as the camera says, and the orientation tag dropped with it
                    .rotate()
                    .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
                    // date and place stay in the copy: the caption of the widgets reads them
                    .keepExif()
                    .jpeg({ quality: 85, progressive: true })
                    .toBuffer();
            } catch {
                // sharp cannot read it: the file as it is, if a browser can show it
                if (!BROWSER_FILE.test(picture.name)) {
                    throw new Error(`${picture.name} cannot be converted`);
                }
                data = original;
            }
        }
        await this.storage.write(path, data);
        this.files.set(path, { size: data.length, used: this.now() });
        this.total += data.length;
        await this.trim(path);
        return `${this.namespace}/${path}`;
    }

    /**
     * Drop the copies used longest ago until the cache fits
     *
     * @param keep - the copy just made
     */
    private async trim(keep?: string): Promise<void> {
        if (this.total <= this.limitBytes) {
            return;
        }
        const oldest = [...this.files.entries()]
            .filter(([path]) => path !== keep)
            .sort((a, b) => a[1].used - b[1].used);
        for (const [path, file] of oldest) {
            if (this.total <= this.limitBytes * 0.9) {
                break;
            }
            this.files.delete(path);
            this.total -= file.size;
            try {
                await this.storage.delete(path);
            } catch {
                // gone already
            }
        }
    }

    /**
     * Drop the copies of albums that are no longer configured
     *
     * @param albumIds - the albums there are
     */
    async forgetOthers(albumIds: string[]): Promise<void> {
        const keep = new Set(albumIds);
        for (const [path, file] of [...this.files.entries()]) {
            const album = path.split('/')[1];
            if (!keep.has(album)) {
                this.files.delete(path);
                this.total -= file.size;
                await this.storage.delete(path).catch(() => undefined);
            }
        }
    }
}
