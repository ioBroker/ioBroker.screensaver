/**
 * Where the pictures of an album come from: a folder of the ioBroker file storage or a folder of the server. Immich
 * is in `immich.ts`. Every source gives the same: a list of pictures, the head of a file for its EXIF, the file.
 */

import { promises as fs } from 'node:fs';
import { join, posix } from 'node:path';

import type { Picture } from './types';

/** The files the albums take: what a browser shows, and what sharp turns into a JPEG for it */
const PICTURE_FILE = /\.(jpe?g|png|webp|gif|avif|tiff?|bmp)$/i;

/** Files a browser shows as they are: no need to reduce them when they are small */
export const BROWSER_FILE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/**
 * Is this a picture an album takes
 *
 * @param name - the file name
 */
export function isPictureFile(name: string): boolean {
    return PICTURE_FILE.test(name) && !name.startsWith('.');
}

/** A picture of a source, and whether the source already knows its date and size */
export interface SourceEntry extends Picture {
    /** The source knows date, size and place: no need to read the file */
    known?: boolean;
}

export interface PictureSource {
    /** All pictures with what is known without opening them */
    list(): Promise<SourceEntry[]>;
    /** The first bytes of a file, for its EXIF */
    readHead(key: string, bytes: number): Promise<Uint8Array>;
    /**
     * The file, to be reduced to `edge`; a source that reduces itself (Immich) gives a smaller copy
     *
     * @param key - the picture
     * @param edge - the longest edge it will be shown with
     */
    read(key: string, edge: number): Promise<Buffer>;
    /** A file of the storage a browser may load as it is, like `0_userdata.0/fotos/a.jpg` */
    storagePath?(key: string): string;
}

/** What the source of a storage folder needs of the adapter */
export interface FileStorage {
    readDir(
        namespace: string,
        path: string,
    ): Promise<{ file: string; isDir: boolean; size?: number; modified?: number }[]>;
    readFile(namespace: string, path: string): Promise<Buffer>;
    /** Where the file lies on the disk of this host, if the storage keeps it there; null otherwise */
    localPath(namespace: string, path: string): string | null;
}

/**
 * Read the first bytes of a file on the disk
 *
 * @param file - the path
 * @param bytes - how many
 */
async function readFileHead(file: string, bytes: number): Promise<Uint8Array> {
    const handle = await fs.open(file, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

/**
 * Split `0_userdata.0/fotos/` into the object and the path in it
 *
 * @param location - as typed in the album
 */
export function parseStorageLocation(location: string): { namespace: string; path: string } | null {
    const value = location
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\/{2,}/g, '/');
    if (!value) {
        return null;
    }
    const [namespace, ...rest] = value.split('/');
    return { namespace, path: rest.join('/') };
}

/** A folder of the ioBroker file storage */
export class StorageSource implements PictureSource {
    private readonly namespace: string;
    private readonly path: string;

    constructor(
        private readonly storage: FileStorage,
        location: string,
        private readonly recursive: boolean,
    ) {
        const parsed = parseStorageLocation(location);
        if (!parsed) {
            throw new Error('No folder');
        }
        this.namespace = parsed.namespace;
        this.path = parsed.path;
    }

    private filePath(key: string): string {
        return this.path ? `${this.path}/${key}` : key;
    }

    async list(): Promise<SourceEntry[]> {
        const result: SourceEntry[] = [];
        const walk = async (sub: string): Promise<void> => {
            const folder = [this.path, sub].filter(Boolean).join('/');
            const entries = await this.storage.readDir(this.namespace, folder);
            for (const entry of entries) {
                const key = sub ? `${sub}/${entry.file}` : entry.file;
                if (entry.isDir) {
                    if (this.recursive && !entry.file.startsWith('.')) {
                        await walk(key);
                    }
                } else if (isPictureFile(entry.file)) {
                    result.push({ key, name: entry.file, size: entry.size, version: String(entry.modified || '') });
                }
            }
        };
        await walk('');
        return result;
    }

    async readHead(key: string, bytes: number): Promise<Uint8Array> {
        const local = this.storage.localPath(this.namespace, this.filePath(key));
        if (local) {
            try {
                return await readFileHead(local, bytes);
            } catch {
                // the storage does not keep its files here after all
            }
        }
        const data = await this.storage.readFile(this.namespace, this.filePath(key));
        return data.subarray(0, bytes);
    }

    read(key: string): Promise<Buffer> {
        return this.storage.readFile(this.namespace, this.filePath(key));
    }

    storagePath(key: string): string {
        return `${this.namespace}/${this.filePath(key)}`;
    }
}

/** A folder of the server, like a share of the NAS mounted on the ioBroker host */
export class PathSource implements PictureSource {
    private readonly root: string;

    constructor(
        location: string,
        private readonly recursive: boolean,
    ) {
        this.root = location.trim();
        if (!this.root) {
            throw new Error('No folder');
        }
    }

    /**
     * The file of a key; a key that leads out of the folder is no key of this album
     *
     * @param key - the path inside the folder, with `/`
     */
    private file(key: string): string {
        const normal = posix.normalize(key);
        if (normal.startsWith('..') || posix.isAbsolute(normal)) {
            throw new Error('Not in the album');
        }
        return join(this.root, ...normal.split('/'));
    }

    async list(): Promise<SourceEntry[]> {
        const result: SourceEntry[] = [];
        const walk = async (sub: string): Promise<void> => {
            const entries = await fs.readdir(sub ? join(this.root, ...sub.split('/')) : this.root, {
                withFileTypes: true,
            });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name.startsWith('@')) {
                    // hidden files, and the thumbnails a Synology keeps in `@eaDir`
                    continue;
                }
                const key = sub ? `${sub}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (this.recursive) {
                        await walk(key);
                    }
                } else if (entry.isFile() && isPictureFile(entry.name)) {
                    try {
                        const stat = await fs.stat(this.file(key));
                        result.push({ key, name: entry.name, size: stat.size, version: String(stat.mtimeMs) });
                    } catch {
                        // gone while reading
                    }
                }
            }
        };
        await walk('');
        return result;
    }

    readHead(key: string, bytes: number): Promise<Uint8Array> {
        return readFileHead(this.file(key), bytes);
    }

    read(key: string): Promise<Buffer> {
        return fs.readFile(this.file(key));
    }
}
