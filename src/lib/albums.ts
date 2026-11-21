/**
 * The albums of the instance and what the widgets ask of them: the list of an album through a date filter, and a
 * picture reduced to the size of the frame.
 */

import { AlbumIndex, type IndexLogger, type IndexStore } from './albumIndex';
import { dayNumber, filtersByDate, floatingToText, makeDateTest, readDateFilter, toFloating } from './dateFilter';
import { GoogleSource, type GoogleAccess } from './googlePhotos';
import type { ImmichClient } from './immich';
import { ImmichSource } from './immich';
import { edgeFor, type PictureCache } from './pictureCache';
import { PathSource, StorageSource, type FileStorage, type PictureSource } from './sources';
import type { AlbumConfig, ListAnswer, ListedPicture, Picture, PictureAnswer } from './types';

const ALBUM_ID = /^[\w-]+$/;

/**
 * A text of a message: what a widget sends is not always a string
 *
 * @param value - a value of the message
 */
function textOf(value: unknown): string {
    return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** A widget gets at most this many pictures of one album: a selection of a large one, new every day */
const DEFAULT_LIMIT = 3000;
const MAX_LIMIT = 10000;

/** How long the first `list` of an album waits for its first scan before it answers with what is there */
const FIRST_SCAN_WAIT_MS = 15_000;

export interface AlbumsOptions {
    storage: FileStorage;
    /** The client of Immich, or where to get it (Immich in Docker); null where URL or key are missing */
    immich: ImmichClient | (() => ImmichClient) | null;
    /** The connection to Google Photos; null where it is not set up */
    google?: GoogleAccess | null;
    store: IndexStore;
    cache: PictureCache;
    log: IndexLogger;
    maxEdge: number;
    /** Now; the date filters ask it */
    now?: () => Date;
}

/**
 * A random number generator with a seed: the same selection of a large album all day long
 *
 * @param seed - the seed
 */
function seeded(seed: number): () => number {
    let state = seed >>> 0 || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

/**
 * Oldest first; pictures without a date at the end, by name
 *
 * @param a - a picture
 * @param b - another one
 */
function byDate(a: Picture, b: Picture): number {
    const da = a.date ?? Infinity;
    const db = b.date ?? Infinity;
    if (da !== db) {
        return da < db ? -1 : 1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * A picture in the short form of `list`
 *
 * @param picture - the picture
 */
function toListed(picture: Picture): ListedPicture {
    const listed: ListedPicture = { k: picture.key };
    if (picture.date !== undefined) {
        listed.d = floatingToText(picture.date);
    }
    if (picture.width && picture.height) {
        listed.w = picture.width;
        listed.h = picture.height;
    }
    if (picture.place) {
        listed.p = picture.place;
    }
    if (picture.caption) {
        listed.c = picture.caption;
    }
    return listed;
}

export class Albums {
    private readonly indexes = new Map<string, AlbumIndex>();

    constructor(private readonly deps: AlbumsOptions) {}

    /**
     * Take the albums of the configuration
     *
     * @param albums - as configured
     * @returns the problems, one text each
     */
    configure(albums: AlbumConfig[]): string[] {
        const problems: string[] = [];
        this.indexes.clear();
        for (const album of albums || []) {
            if (album.enabled === false) {
                continue;
            }
            const id = String(album.id || '').trim();
            if (!ALBUM_ID.test(id)) {
                problems.push(`Album "${album.name || id}": the ID may only have letters, digits, "-" and "_"`);
                continue;
            }
            if (this.indexes.has(id)) {
                problems.push(`Album "${id}" is configured twice; the second one is ignored`);
                continue;
            }
            const config: AlbumConfig = {
                enabled: true,
                id,
                name: String(album.name || id),
                type: album.type,
                location: String(album.location || ''),
                recursive: album.recursive !== false,
            };
            try {
                this.indexes.set(id, new AlbumIndex(config, this.makeSource(config), this.deps.store, this.deps.log));
            } catch (e) {
                problems.push(`Album "${id}": ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return problems;
    }

    private makeSource(album: AlbumConfig): PictureSource {
        switch (album.type) {
            case 'storage':
                return new StorageSource(this.deps.storage, album.location, album.recursive);
            case 'path':
                return new PathSource(album.location, album.recursive);
            case 'immich':
                if (!this.deps.immich) {
                    throw new Error('URL or API key of Immich are missing');
                }
                return new ImmichSource(this.deps.immich, album.location);
            case 'google':
                if (!this.deps.google) {
                    throw new Error('Google Photos is not available');
                }
                return new GoogleSource(this.deps.google, album.location, () => this.now().getTime());
            default:
                throw new Error(`unknown source "${String(album.type)}"`);
        }
    }

    get ids(): string[] {
        return [...this.indexes.keys()];
    }

    get(id: string): AlbumIndex | undefined {
        return this.indexes.get(id);
    }

    all(): AlbumIndex[] {
        return [...this.indexes.values()];
    }

    /** The albums as options of a select: `[{ value, label }]` */
    selectOptions(): { value: string; label: string }[] {
        return this.all().map(index => ({ value: index.config.id, label: index.config.name }));
    }

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date();
    }

    /**
     * The pictures of an album a widget shows today
     *
     * @param message - `{ album, filter, fallback, limit }`
     */
    async list(message: unknown): Promise<ListAnswer> {
        const data = (message && typeof message === 'object' ? message : {}) as Record<string, unknown>;
        const index = this.indexes.get(textOf(data.album));
        if (!index) {
            return { error: 'album_not_found' };
        }
        await index.load();
        if (!index.ready) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
                index.scan(),
                new Promise(resolve => {
                    timer = setTimeout(resolve, FIRST_SCAN_WAIT_MS);
                }),
            ]);
            clearTimeout(timer);
        }
        const all = index.all();
        if (!all.length && index.error) {
            return { error: 'album_failed', reason: index.error, total: 0 };
        }

        const filter = readDateFilter(data.filter);
        const now = toFloating(this.now());
        let chosen = all;
        let fallback = false;
        if (filtersByDate(filter)) {
            const test = makeDateTest(filter, now);
            chosen = all.filter(picture => test(picture.date));
            if (!chosen.length && data.fallback !== false) {
                chosen = all;
                fallback = true;
            }
        }
        const matched = fallback ? 0 : chosen.length;

        const wanted = Number(data.limit);
        const limit = Number.isFinite(wanted) && wanted > 0 ? Math.min(MAX_LIMIT, Math.round(wanted)) : DEFAULT_LIMIT;
        if (chosen.length > limit) {
            // a selection of the day: the same for every widget and every reload today
            const random = seeded(dayNumber(now) * 31 + index.config.id.length);
            const copy = [...chosen];
            for (let i = copy.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            chosen = copy.slice(0, limit);
        }

        return {
            pictures: [...chosen].sort(byDate).map(toListed),
            total: all.length,
            matched,
            fallback,
            scanning: index.scanning,
        };
    }

    /**
     * Where the browser loads a picture, reduced to the frame
     *
     * @param message - `{ album, key, width, height }`, the size of the frame in device pixels
     */
    async picture(message: unknown): Promise<PictureAnswer> {
        const data = (message && typeof message === 'object' ? message : {}) as Record<string, unknown>;
        const index = this.indexes.get(textOf(data.album));
        if (!index) {
            return { error: 'album_not_found' };
        }
        await index.load();
        const picture = index.get(textOf(data.key));
        if (!picture) {
            return { error: 'picture_not_found' };
        }
        const edge = edgeFor(Number(data.width), Number(data.height), this.deps.maxEdge);
        try {
            return { url: await this.deps.cache.get(index.config.id, picture, index.getSource(), edge) };
        } catch (e) {
            this.deps.log.warn(
                `Album "${index.config.id}": ${picture.name} cannot be prepared: ${e instanceof Error ? e.message : String(e)}`,
            );
            return { error: 'picture_failed' };
        }
    }
}
