/**
 * What an album holds: its pictures with date, size and place, read once and kept.
 *
 * A folder is listed again on every scan, but a file is only opened when it is new or changed - the head of the
 * file (EXIF) is read with the reader of the widgets. The index is stored in the data folder of the instance, so a
 * restart does not open thousands of files again.
 */

import { displaySize, readImageMeta } from '../../src-widgets/src/lib/imageMeta';
import { toFloating } from './dateFilter';
import type { PictureSource, SourceEntry } from './sources';
import type { AlbumConfig, Picture } from './types';

/** EXIF, XMP and IPTC sit in the first part of the file */
const HEAD_BYTES = 256 * 1024;

/** Files opened at once while scanning */
const PARALLEL_READS = 3;

/** Store the index while a large album is read for the first time, not only at the end */
const SAVE_EVERY = 500;

export interface IndexStore {
    load(albumId: string): Promise<Picture[] | null>;
    save(albumId: string, pictures: Picture[]): Promise<void>;
    /** Delete the stored index of an album */
    remove(albumId: string): Promise<void>;
}

export interface IndexLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
}

/**
 * A date in a file name, as phones and messengers write it: `IMG_20241120_140312.jpg`, `IMG-20241120-WA0001.jpg`,
 * `PXL_20241120_140312345.jpg`, `2024-11-20 14.03.12.jpg`, `Screenshot_20241120-140312.png`
 *
 * @param name - the file name
 * @returns floating milliseconds, or undefined
 */
export function dateFromName(name: string): number | undefined {
    const match =
        /(?:^|[^\d])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_ T.]?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?/.exec(
            name,
        );
    if (!match) {
        return undefined;
    }
    const [, y, m, d, hh, mm, ss] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh || 12), Number(mm || 0), Number(ss || 0));
}

/**
 * The picture as the index keeps it: without what only the source needs
 *
 * @param entry - from the source
 */
function toPicture(entry: SourceEntry): Picture {
    const { known: _known, ...picture } = entry;
    return picture;
}

export class AlbumIndex {
    private pictures = new Map<string, Picture>();
    private loaded = false;
    private running: Promise<void> | null = null;
    /** A scan finished, or the stored index was there */
    ready = false;
    /** The last scan failed: why */
    error: string | null = null;
    /** Counted up by `forget`: a scan that started before must not bring the pictures back */
    private generation = 0;

    constructor(
        public readonly config: AlbumConfig,
        private readonly source: PictureSource,
        private readonly store: IndexStore,
        private readonly log: IndexLogger,
    ) {}

    get size(): number {
        return this.pictures.size;
    }

    /** All pictures, in no particular order */
    all(): Picture[] {
        return [...this.pictures.values()];
    }

    get(key: string): Picture | undefined {
        return this.pictures.get(key);
    }

    getSource(): PictureSource {
        return this.source;
    }

    /** Read the stored index, once */
    async load(): Promise<void> {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        try {
            const stored = await this.store.load(this.config.id);
            if (stored?.length) {
                this.pictures = new Map(stored.map(picture => [picture.key, picture]));
                this.ready = true;
            }
        } catch (e) {
            this.log.debug(
                `Album "${this.config.id}": no stored index (${e instanceof Error ? e.message : String(e)})`,
            );
        }
    }

    /** Read the album again; a scan that runs is not started twice */
    scan(): Promise<void> {
        if (this.running === null) {
            this.running = this.doScan().finally(() => {
                this.running = null;
            });
        }
        return this.running;
    }

    get scanning(): boolean {
        return this.running !== null;
    }

    /**
     * Drop what is known of the album, in memory and stored: for an album whose access was withdrawn (Google
     * Photos). The next request reads the album again.
     */
    async forget(): Promise<void> {
        this.generation++;
        this.pictures = new Map();
        this.ready = false;
        this.error = null;
        this.source.forget?.();
        try {
            await this.store.remove(this.config.id);
        } catch (e) {
            this.log.warn(
                `Album "${this.config.id}": stored index not deleted: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    private async doScan(): Promise<void> {
        await this.load();
        const started = Date.now();
        const generation = this.generation;
        let entries: SourceEntry[];
        try {
            entries = await this.source.list();
            if (generation !== this.generation) {
                return;
            }
            this.error = null;
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
            this.log.warn(`Album "${this.config.id}" cannot be read: ${this.error}`);
            // what was read before is still shown
            this.ready = true;
            return;
        }

        const next = new Map<string, Picture>();
        const toRead: SourceEntry[] = [];
        for (const entry of entries) {
            const old = this.pictures.get(entry.key);
            if (entry.known) {
                next.set(entry.key, toPicture(entry));
            } else if (old && old.size === entry.size && old.version === entry.version) {
                next.set(entry.key, old);
            } else {
                // listed at once without its date; the date follows when the file was opened
                const picture = toPicture(entry);
                const fromName = dateFromName(entry.name);
                if (fromName !== undefined) {
                    picture.date = fromName;
                }
                next.set(entry.key, picture);
                toRead.push(entry);
            }
        }
        this.pictures = next;
        this.ready = true;

        if (toRead.length) {
            this.log.debug(`Album "${this.config.id}": reading ${toRead.length} new or changed files`);
        }
        let done = 0;
        const worker = async (): Promise<void> => {
            for (;;) {
                const entry = toRead.shift();
                if (!entry || generation !== this.generation) {
                    return;
                }
                await this.readMeta(entry);
                done++;
                if (done % SAVE_EVERY === 0 && generation === this.generation) {
                    await this.save();
                }
            }
        };
        await Promise.all(Array.from({ length: PARALLEL_READS }, () => worker()));
        if (generation !== this.generation) {
            return;
        }
        await this.save();
        this.log.debug(
            `Album "${this.config.id}": ${this.pictures.size} pictures, read in ${Math.round((Date.now() - started) / 100) / 10} s`,
        );
    }

    private async readMeta(entry: SourceEntry): Promise<void> {
        const picture = this.pictures.get(entry.key);
        if (!picture) {
            return;
        }
        try {
            const head = await this.source.readHead(entry.key, HEAD_BYTES);
            const meta = readImageMeta(head);
            if (meta.date) {
                picture.date = toFloating(meta.date);
            }
            const size = displaySize(meta);
            if (size) {
                picture.width = size.width;
                picture.height = size.height;
            }
            if (meta.place) {
                picture.place = meta.place;
            }
            if (meta.caption) {
                picture.caption = meta.caption;
            }
            if (typeof meta.latitude === 'number' && typeof meta.longitude === 'number') {
                picture.latitude = meta.latitude;
                picture.longitude = meta.longitude;
            }
        } catch (e) {
            this.log.debug(
                `Album "${this.config.id}": ${entry.key} cannot be read: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    private async save(): Promise<void> {
        try {
            await this.store.save(this.config.id, this.all());
        } catch (e) {
            this.log.warn(`Album "${this.config.id}": index not stored: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
