/**
 * Where the pictures come from: a folder of the ioBroker file storage, a list typed into the editor, or a state.
 *
 * Whatever the source, the result is the same list of `PhotoRef`. A picture is known by its URL, so the same
 * picture keeps its place when the list is read again - that is how a new photo in the folder joins a running
 * slideshow without it starting over.
 */

/** A picture as the list knows it, before it is loaded */
export interface PhotoRef {
    /** Unique in the list; the URL */
    key: string;
    /** What the browser loads, relative to the page of vis-2 or absolute */
    url: string;
    /** From the list: wins over what the file says */
    caption?: string;
    date?: Date;
    place?: string;
    /**
     * Where the picture is, asked only when it is about to be shown: the adapter makes a copy in the size of the
     * frame then (see `adapterAlbum.ts`). `url` is not used where this is set.
     */
    resolve?: (target: { width: number; height: number }, signal: AbortSignal) => Promise<string>;
}

/** The pictures the browser can show */
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i;

/**
 * Where the files of the storage are, seen from the page: vis-2 is `/vis-2/index.html` of the web server, which
 * serves `/<object>/<path>`. A web component tells its own (`/files/` under admin), see `webcomponents/files.ts`.
 */
export const FILES_URL = '../';

/** A folder of the file storage that is named without the path of the page, like `0_userdata.0/fotos` */
const STORAGE_PATH = /^[\w-]+(\.[\w-]+)*\.\d+\//;

/**
 * Is this the name of a picture file?
 *
 * @param name - a file name
 */
export function isImageFile(name: string): boolean {
    return IMAGE_FILE.test(name);
}

/**
 * The URL of a picture as the browser has to load it.
 *
 * vis-2 stores a picture of the project as `_PRJ_NAME/...`, and a picture of the file storage is often typed
 * as `0_userdata.0/fotos/a.jpg`. Both are files of the web server, which serves `/<object>/<path>`; the page of
 * vis-2 is `/vis-2/index.html`, so `../` leads there - relative, because ioBroker may sit behind a proxy under
 * a path of its own.
 *
 * @param url - what was typed or stored
 * @param projectPath - the folder of the project, like `../vis-2.0/main`
 * @param filesUrl - where the web server serves the file storage, see {@link FILES_URL}
 */
export function resolveUrl(url: string, projectPath: string, filesUrl = FILES_URL): string {
    const value = url.trim();
    if (!value) {
        return '';
    }
    if (value.startsWith('_PRJ_NAME')) {
        const rest = value.substring('_PRJ_NAME'.length).replace(/^\/+/, '');
        return `${projectPath}/${rest}`;
    }
    if (/^(https?:|data:|blob:|\/|\.\.?\/)/i.test(value)) {
        return value;
    }
    if (STORAGE_PATH.test(value)) {
        return `${filesUrl}${value}`;
    }
    return value;
}

/** A folder of the file storage, split into the object that holds it and the path inside */
export interface StorageFolder {
    /** The meta object, like `0_userdata.0` or `vis-2.0` */
    namespace: string;
    /** The path inside it without slashes around, like `fotos` or `main/fotos`; empty for the root */
    path: string;
}

/**
 * Where a folder lies in the file storage.
 *
 * @param folder - as typed: `0_userdata.0/fotos`, `/0_userdata.0/fotos/`, `../0_userdata.0/fotos` or `_PRJ_NAME/fotos`
 * @param projectFolder - the folder of the project in the storage, like `vis-2.0/main`
 * @returns the folder, or null where nothing usable was typed
 */
export function parseStorageFolder(folder: string, projectFolder: string): StorageFolder | null {
    let value = folder.trim().replace(/\\/g, '/');
    if (!value) {
        return null;
    }
    if (value.startsWith('_PRJ_NAME')) {
        value = `${projectFolder}/${value.substring('_PRJ_NAME'.length)}`;
    }
    value = value
        .replace(/^(\.\.?\/)+/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/{2,}/g, '/');
    if (!value) {
        return null;
    }
    const [namespace, ...rest] = value.split('/');
    return { namespace, path: rest.join('/') };
}

/**
 * The URL of a file of the storage, every part encoded
 *
 * @param folder - the folder of the storage
 * @param file - the path of the file inside the folder
 * @param filesUrl - where the web server serves the file storage, see {@link FILES_URL}
 */
export function storageFileUrl(folder: StorageFolder, file: string, filesUrl = FILES_URL): string {
    const parts = [folder.namespace, ...folder.path.split('/'), ...file.split('/')].filter(Boolean);
    return `${filesUrl}${parts.map(part => encodeURIComponent(part)).join('/')}`;
}

/** What `readDir` of the socket returns, as far as it matters here */
export interface DirEntry {
    file: string;
    isDir: boolean;
}

export type ReadDir = (namespace: string, path: string) => Promise<DirEntry[]>;

/** Comparing names the way a person sorts them: `IMG_2` before `IMG_10` */
const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;

/**
 * Sort file paths like a person would
 *
 * @param a - one path
 * @param b - the other
 */
export function compareNames(a: string, b: string): number {
    return collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
}

/** How deep subfolders are read, and how many pictures at most: a whole photo archive is no slideshow */
const MAX_DEPTH = 4;
const MAX_FILES = 5000;

/**
 * The pictures of a folder of the file storage, sorted by name.
 *
 * Hidden files and folders (`.thumbs`, `@eaDir` of a Synology) are left out.
 *
 * @param readDir - reads one folder
 * @param folder - the folder
 * @param recursive - with the subfolders
 * @param filesUrl - where the web server serves the file storage, see {@link FILES_URL}
 * @returns the pictures; rejects if the folder itself cannot be read
 */
export async function listStorageFolder(
    readDir: ReadDir,
    folder: StorageFolder,
    recursive: boolean,
    filesUrl = FILES_URL,
): Promise<PhotoRef[]> {
    const files: string[] = [];

    const walk = async (subPath: string, depth: number, mustExist: boolean): Promise<void> => {
        let entries: DirEntry[];
        try {
            entries = await readDir(folder.namespace, [folder.path, subPath].filter(Boolean).join('/'));
        } catch (e) {
            if (mustExist) {
                throw e;
            }
            return;
        }
        const dirs: string[] = [];
        for (const entry of entries || []) {
            if (!entry?.file || entry.file.startsWith('.') || entry.file.startsWith('@')) {
                continue;
            }
            const name = subPath ? `${subPath}/${entry.file}` : entry.file;
            if (entry.isDir) {
                dirs.push(name);
            } else if (isImageFile(entry.file) && files.length < MAX_FILES) {
                files.push(name);
            }
        }
        if (recursive && depth < MAX_DEPTH) {
            for (const dir of dirs) {
                await walk(dir, depth + 1, false);
            }
        }
    };

    await walk('', 0, true);

    files.sort(compareNames);
    return files.map(file => {
        const url = storageFileUrl(folder, file, filesUrl);
        return { key: url, url };
    });
}

/**
 * The pictures typed into the editor: one per line, a caption after `|`. Empty lines and lines starting with
 * `#` are left out.
 *
 * @param text - what was typed
 * @param projectPath - the folder of the project, like `../vis-2.0/main`
 * @param filesUrl - where the web server serves the file storage, see {@link FILES_URL}
 */
export function parseUrlList(text: string, projectPath: string, filesUrl = FILES_URL): PhotoRef[] {
    const result: PhotoRef[] = [];
    const seen = new Set<string>();
    for (const rawLine of (text || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const pos = line.indexOf('|');
        const url = resolveUrl(pos === -1 ? line : line.substring(0, pos), projectPath, filesUrl);
        const caption = pos === -1 ? '' : line.substring(pos + 1).trim();
        if (url && !seen.has(url)) {
            seen.add(url);
            result.push({ key: url, url, caption: caption || undefined });
        }
    }
    return result;
}

/**
 * A date out of a list: a `Date`, milliseconds or seconds since 1970, ISO text, or the `2023:07:14 18:22:05` of EXIF
 *
 * @param value - what the list says
 */
export function parseDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? undefined : value;
    }
    if (typeof value === 'number' && isFinite(value) && value > 0) {
        // before 2001 in milliseconds means it was given in seconds
        return new Date(value < 1e12 ? value * 1000 : value);
    }
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }
    const text = value.trim();
    const exif = text.match(/^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (exif) {
        const date = new Date(
            parseInt(exif[1], 10),
            parseInt(exif[2], 10) - 1,
            parseInt(exif[3], 10),
            parseInt(exif[4] || '12', 10),
            parseInt(exif[5] || '0', 10),
            parseInt(exif[6] || '0', 10),
        );
        return isNaN(date.getTime()) || date.getFullYear() < 1900 ? undefined : date;
    }
    if (/^\d+$/.test(text)) {
        return parseDate(parseInt(text, 10));
    }
    const date = new Date(text);
    return isNaN(date.getTime()) ? undefined : date;
}

function pickText(entry: Record<string, unknown>, names: string[]): string | undefined {
    for (const name of names) {
        const value = entry[name];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number' && isFinite(value)) {
            return String(value);
        }
    }
    return undefined;
}

function entryToRef(entry: unknown, projectPath: string, filesUrl: string): PhotoRef | null {
    if (typeof entry === 'string') {
        const url = resolveUrl(entry, projectPath, filesUrl);
        return url ? { key: url, url } : null;
    }
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const item = entry as Record<string, unknown>;
    const raw = pickText(item, ['url', 'src', 'image', 'img', 'path', 'href', 'file']);
    const url = raw ? resolveUrl(raw, projectPath, filesUrl) : '';
    if (!url) {
        return null;
    }
    return {
        key: url,
        url,
        caption: pickText(item, ['caption', 'title', 'text', 'description', 'name']),
        date: parseDate(item.date ?? item.taken ?? item.takenAt ?? item.time ?? item.timestamp),
        place: pickText(item, ['place', 'location', 'city', 'where']),
    };
}

/**
 * The pictures out of the value of a state.
 *
 * Accepted: a single URL; a JSON array of URLs or of objects `{ url, date, place, caption }`; or a JSON object
 * that holds such an array under `images`, `photos`, `items` or `list`. A script or an adapter that writes
 * something close to that should not need to be changed for it, so the field names are taken generously.
 *
 * @param value - the value of the state
 * @param projectPath - the folder of the project, like `../vis-2.0/main`
 * @param filesUrl - where the web server serves the file storage, see {@link FILES_URL}
 */
export function parseStateList(value: unknown, projectPath: string, filesUrl = FILES_URL): PhotoRef[] {
    let data: unknown = value;
    if (typeof data === 'string') {
        const text = data.trim();
        if (!text) {
            return [];
        }
        if (text.startsWith('[') || text.startsWith('{')) {
            try {
                data = JSON.parse(text);
            } catch {
                return [];
            }
        } else {
            // several URLs in one string, as a script might join them
            data = text.split(/[\r\n]+/);
        }
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        const list = obj.images ?? obj.photos ?? obj.items ?? obj.list ?? obj.pictures;
        data = Array.isArray(list) ? list : [obj];
    }
    if (!Array.isArray(data)) {
        return [];
    }
    const result: PhotoRef[] = [];
    const seen = new Set<string>();
    for (const entry of data) {
        const ref = entryToRef(entry, projectPath, filesUrl);
        if (ref && !seen.has(ref.key)) {
            seen.add(ref.key);
            result.push(ref);
        }
    }
    return result;
}

/**
 * Two lists hold the same pictures in the same order, with the same captions
 *
 * @param a - one list
 * @param b - the other
 */
export function sameList(a: PhotoRef[], b: PhotoRef[]): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    return a.every(
        (ref, i) =>
            ref.key === b[i].key &&
            ref.caption === b[i].caption &&
            ref.place === b[i].place &&
            ref.date?.getTime() === b[i].date?.getTime(),
    );
}
