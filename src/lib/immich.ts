/**
 * Immich (https://immich.app), the photo server many people run next to ioBroker: a whole library or one album.
 *
 * Only reads: the API key may be one with the permissions `asset.read`, `asset.view`, `asset.download` and
 * `album.read`. The key stays in the adapter; the browser gets the reduced copies from the file storage.
 */

import { isPictureFile, type PictureSource, type SourceEntry } from './sources';

/** The size Immich makes its previews in, unless set otherwise there */
export const IMMICH_PREVIEW_EDGE = 1440;

/** One page of the search; Immich allows up to 1000 */
const PAGE_SIZE = 1000;

/** A library larger than this is read no further: the widgets show a selection anyway */
const MAX_ASSETS = 200_000;

const TIMEOUT_MS = 30_000;

/** Originals that sharp can read; for others (HEIC, RAW) the preview of Immich is taken */
const DECODABLE = /\.(jpe?g|png|webp|gif|avif|tiff?)$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FetchFn = typeof fetch;

/** The parts of an asset of Immich that matter here */
export interface ImmichAsset {
    id: string;
    type?: string;
    originalFileName?: string;
    localDateTime?: string;
    fileCreatedAt?: string;
    updatedAt?: string;
    checksum?: string;
    isTrashed?: boolean;
    width?: number | null;
    height?: number | null;
    exifInfo?: {
        exifImageWidth?: number | null;
        exifImageHeight?: number | null;
        orientation?: string | number | null;
        dateTimeOriginal?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        city?: string | null;
        state?: string | null;
        country?: string | null;
        description?: string | null;
    } | null;
}

export interface ImmichAlbum {
    id: string;
    albumName: string;
    assetCount?: number;
}

export class ImmichError extends Error {
    constructor(
        message: string,
        public readonly status = 0,
    ) {
        super(message);
    }
}

/** A tiny client of the REST API of Immich */
export class ImmichClient {
    private readonly base: string;

    constructor(
        url: string,
        private readonly apiKey: string,
        private readonly fetchFn: FetchFn = fetch,
    ) {
        this.base = url
            .trim()
            .replace(/\/+$/, '')
            .replace(/\/api$/, '');
        if (!/^https?:\/\//i.test(this.base)) {
            throw new ImmichError('The URL of Immich must start with http:// or https://');
        }
        if (!apiKey.trim()) {
            throw new ImmichError('No API key of Immich');
        }
    }

    private async request(path: string, init: RequestInit = {}): Promise<Response> {
        let response: Response;
        try {
            response = await this.fetchFn(`${this.base}/api${path}`, {
                ...init,
                headers: {
                    'x-api-key': this.apiKey.trim(),
                    Accept: 'application/json',
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(init.headers as Record<string, string> | undefined),
                },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (e) {
            throw new ImmichError(`Immich is not reachable: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const reason =
                response.status === 401 || response.status === 403
                    ? 'the API key is not accepted or lacks a permission'
                    : text.substring(0, 200) || response.statusText;
            throw new ImmichError(`Immich answered ${response.status} for ${path}: ${reason}`, response.status);
        }
        return response;
    }

    private async json<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await this.request(path, init);
        return (await response.json()) as T;
    }

    /** Who the key belongs to: a check of URL and key */
    async me(): Promise<{ name?: string; email?: string }> {
        return this.json('/users/me');
    }

    albums(): Promise<ImmichAlbum[]> {
        return this.json('/albums');
    }

    /**
     * The id of an album by its name or id
     *
     * @param nameOrId - as typed in the album of the adapter
     */
    async findAlbum(nameOrId: string): Promise<ImmichAlbum | null> {
        const wanted = nameOrId.trim();
        const albums = await this.albums();
        return (
            albums.find(album => album.id === wanted) ||
            albums.find(album => album.albumName === wanted) ||
            albums.find(album => album.albumName.toLowerCase() === wanted.toLowerCase()) ||
            null
        );
    }

    /**
     * All pictures of the library or of an album
     *
     * @param albumId - the album; none for the whole library
     */
    async images(albumId?: string): Promise<ImmichAsset[]> {
        const result: ImmichAsset[] = [];
        let page: number | null = 1;
        while (page !== null && result.length < MAX_ASSETS) {
            const body: Record<string, unknown> = {
                page,
                size: PAGE_SIZE,
                type: 'IMAGE',
                withExif: true,
                // archived pictures are hidden on purpose; Immich drops what its version does not know
                visibility: 'timeline',
                isArchived: false,
            };
            if (albumId) {
                body.albumIds = [albumId];
            }
            let answer: { assets?: { items?: ImmichAsset[]; nextPage?: string | number | null } };
            try {
                answer = await this.json('/search/metadata', { method: 'POST', body: JSON.stringify(body) });
            } catch (e) {
                if (albumId && e instanceof ImmichError && e.status === 400 && page === 1) {
                    // an Immich that cannot search in albums: the album with its pictures
                    const album = await this.json<{ assets?: ImmichAsset[] }>(`/albums/${encodeURIComponent(albumId)}`);
                    return (album.assets || []).filter(asset => asset.type === 'IMAGE' && !asset.isTrashed);
                }
                throw e;
            }
            const items = answer.assets?.items || [];
            result.push(...items.filter(asset => !asset.isTrashed && (!asset.type || asset.type === 'IMAGE')));
            const next = answer.assets?.nextPage;
            page = next !== null && next !== undefined && next !== '' && items.length ? Number(next) : null;
            if (page !== null && !Number.isFinite(page)) {
                page = null;
            }
        }
        return result;
    }

    /**
     * The preview Immich made of a picture (1440 px by default)
     *
     * @param id - the asset
     */
    async preview(id: string): Promise<Buffer> {
        const response = await this.request(`/assets/${encodeURIComponent(id)}/thumbnail?size=preview`, {
            headers: { Accept: 'image/*' },
        });
        return Buffer.from(await response.arrayBuffer());
    }

    /**
     * The file as it was uploaded
     *
     * @param id - the asset
     */
    async original(id: string): Promise<Buffer> {
        const response = await this.request(`/assets/${encodeURIComponent(id)}/original`, {
            headers: { Accept: 'application/octet-stream' },
        });
        return Buffer.from(await response.arrayBuffer());
    }
}

/**
 * What the album knows of an asset
 *
 * @param asset - as Immich gives it
 */
export function assetToEntry(asset: ImmichAsset): SourceEntry {
    const exif = asset.exifInfo || {};
    // `localDateTime` is the wall-clock time of the picture written as UTC: exactly the floating time
    const dateText = asset.localDateTime || exif.dateTimeOriginal || asset.fileCreatedAt || '';
    const date = dateText ? Date.parse(dateText) : NaN;
    let width = asset.width || exif.exifImageWidth || undefined;
    let height = asset.height || exif.exifImageHeight || undefined;
    const orientation = parseInt(String(exif.orientation ?? ''), 10);
    if (!asset.width && width && height && orientation >= 5 && orientation <= 8) {
        [width, height] = [height, width];
    }
    const place = [exif.city, exif.country].filter(part => typeof part === 'string' && part.trim()).join(', ');
    const entry: SourceEntry = {
        key: asset.id,
        name: asset.originalFileName || asset.id,
        version: asset.checksum || asset.updatedAt || '',
        known: true,
    };
    if (Number.isFinite(date)) {
        entry.date = date;
    }
    if (width && height) {
        entry.width = width;
        entry.height = height;
    }
    if (place) {
        entry.place = place;
    }
    if (exif.description?.trim()) {
        entry.caption = exif.description.trim();
    }
    if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
        entry.latitude = exif.latitude;
        entry.longitude = exif.longitude;
    }
    return entry;
}

/** An album of Immich, or its whole library */
export class ImmichSource implements PictureSource {
    private albumId: string | null = null;
    private readonly names = new Map<string, string>();

    /**
     * @param immich - the client, or where to get it: Immich in Docker is there only once its server runs
     * @param location - the album: name or id, empty for the whole library
     */
    constructor(
        private readonly immich: ImmichClient | (() => ImmichClient),
        private readonly location: string,
    ) {}

    private get client(): ImmichClient {
        return typeof this.immich === 'function' ? this.immich() : this.immich;
    }

    private async resolveAlbum(): Promise<string | undefined> {
        const wanted = this.location.trim();
        if (!wanted) {
            return undefined;
        }
        if (UUID.test(wanted)) {
            return wanted;
        }
        if (!this.albumId) {
            const album = await this.client.findAlbum(wanted);
            if (!album) {
                // the settings and the frame show this: tell what may be typed instead
                const names = (await this.client.albums().catch(() => [])).map(it => it.albumName);
                throw new ImmichError(
                    names.length
                        ? `Immich has no album "${wanted}"; its albums: ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}`
                        : `Immich has no album "${wanted}" and no albums at all: leave the location empty for the whole library`,
                    404,
                );
            }
            this.albumId = album.id;
        }
        return this.albumId;
    }

    async list(): Promise<SourceEntry[]> {
        // looked up again on every read: the album may have been renamed
        this.albumId = null;
        const assets = await this.client.images(await this.resolveAlbum());
        this.names.clear();
        return assets.map(asset => {
            const entry = assetToEntry(asset);
            this.names.set(entry.key, entry.name);
            return entry;
        });
    }

    readHead(): Promise<Uint8Array> {
        // never asked: Immich tells the date and the size itself
        return Promise.resolve(new Uint8Array(0));
    }

    async read(key: string, edge: number): Promise<Buffer> {
        const name = this.names.get(key) || '';
        if (edge > IMMICH_PREVIEW_EDGE && DECODABLE.test(name) && isPictureFile(name)) {
            try {
                return await this.client.original(key);
            } catch {
                // the original may be too large or gone: the preview will do
            }
        }
        return this.client.preview(key);
    }
}
