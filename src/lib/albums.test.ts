/// <reference types="node" />
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import sharp from 'sharp';

import { dateFromName, type IndexStore } from './albumIndex';
import { Albums } from './albums';
import { AmbientClient, GoogleSession, OAuthProxy, type GoogleAccess } from './googlePhotos';
import { assetToEntry, ImmichClient, ImmichSource, type ImmichAsset } from './immich';
import { CACHE_FOLDER, edgeFor, PictureCache, type CacheStorage } from './pictureCache';
import { StorageSource, type FileStorage } from './sources';
import type { Picture } from './types';

const quiet = { debug: () => undefined, info: () => undefined, warn: () => undefined };

/**
 * A JPEG with an EXIF date
 *
 * @param width - its width
 * @param height - its height
 * @param taken - `YYYY:MM:DD HH:MM:SS`, none for a file without date
 */
async function photo(width: number, height: number, taken?: string): Promise<Buffer> {
    const image = sharp({ create: { width, height, channels: 3, background: '#4080c0' } }).jpeg();
    return (taken ? image.withExif({ IFD2: { DateTimeOriginal: taken } }) : image).toBuffer();
}

/** An index store in memory */
function memoryStore(): IndexStore & { saved: Map<string, Picture[]> } {
    const saved = new Map<string, Picture[]>();
    return {
        saved,
        load: albumId => Promise.resolve(saved.get(albumId) || null),
        save: (albumId, pictures) => {
            saved.set(albumId, JSON.parse(JSON.stringify(pictures)) as Picture[]);
            return Promise.resolve();
        },
        remove: albumId => {
            saved.delete(albumId);
            return Promise.resolve();
        },
    };
}

/** The storage of the instance in memory */
function memoryCache(): CacheStorage & { files: Map<string, Buffer> } {
    const files = new Map<string, Buffer>();
    return {
        files,
        write: (path, data) => {
            files.set(path, data);
            return Promise.resolve();
        },
        delete: path => {
            files.delete(path);
            return Promise.resolve();
        },
        list: folder =>
            Promise.resolve(
                [...files.entries()]
                    .filter(([path]) => path.startsWith(`${folder}/`))
                    .map(([path, data]) => ({ path, size: data.length, time: 1 })),
            ),
    };
}

const noStorage: FileStorage = {
    readDir: () => Promise.reject(new Error('no storage')),
    readFile: () => Promise.reject(new Error('no storage')),
    localPath: () => null,
};

describe('albums of a folder of the server', () => {
    let root = '';
    const store = memoryStore();
    const storage = memoryCache();
    let albums: Albums;
    let cache: PictureCache;

    before(async () => {
        root = await mkdtemp(join(tmpdir(), 'screensaver-'));
        await mkdir(join(root, 'urlaub'));
        await mkdir(join(root, '@eaDir'));
        await writeFile(join(root, 'a.jpg'), await photo(4000, 3000, '2025:11:20 10:00:00'));
        await writeFile(join(root, 'urlaub', 'b.jpg'), await photo(3000, 4000, '2024:07:14 18:22:05'));
        await writeFile(join(root, 'IMG-20261119-WA0001.jpg'), await photo(800, 600));
        await writeFile(join(root, 'notes.txt'), 'not a picture');
        await writeFile(join(root, '.hidden.jpg'), await photo(10, 10));
        await writeFile(join(root, '@eaDir', 'thumb.jpg'), await photo(10, 10));

        cache = new PictureCache(storage, 'screensaver.0', sharp, 50 * 1024 * 1024);
        await cache.init();
        albums = new Albums({
            storage: noStorage,
            immich: null,
            store,
            cache,
            log: quiet,
            maxEdge: 2560,
            now: () => new Date(2026, 10, 20, 9, 30),
        });
        const problems = albums.configure([
            { enabled: true, id: 'family', name: 'Familie', type: 'path', location: root, recursive: true },
            { enabled: true, id: 'bad id', name: 'x', type: 'path', location: root, recursive: true },
            { enabled: false, id: 'off', name: 'x', type: 'path', location: root, recursive: true },
        ]);
        assert.equal(problems.length, 1, 'the ID with a space is refused');
        assert.deepEqual(albums.selectOptions(), [{ value: 'family', label: 'Familie' }]);
    });

    after(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('lists the pictures with their dates, from EXIF or from the file name', async () => {
        const answer = await albums.list({ album: 'family' });
        assert.equal(answer.total, 3);
        assert.deepEqual(
            answer.pictures?.map(p => [p.k, p.d, p.w, p.h]),
            [
                ['urlaub/b.jpg', '2024-07-14T18:22:05', 3000, 4000],
                ['a.jpg', '2025-11-20T10:00:00', 4000, 3000],
                ['IMG-20261119-WA0001.jpg', '2026-11-19T12:00:00', 800, 600],
            ],
        );
        assert.equal(store.saved.get('family')?.length, 3, 'the index is stored');
    });

    it('filters by date: today a year ago, the last days', async () => {
        const yearAgo = await albums.list({ album: 'family', filter: { mode: 'onThisDay', yearsAgo: 1 } });
        assert.deepEqual(
            yearAgo.pictures?.map(p => p.k),
            ['a.jpg'],
        );
        assert.equal(yearAgo.fallback, false);
        const week = await albums.list({ album: 'family', filter: { mode: 'lastDays', days: 7 } });
        assert.deepEqual(
            week.pictures?.map(p => p.k),
            ['IMG-20261119-WA0001.jpg'],
        );
    });

    it('shows all when nothing matches, unless asked not to', async () => {
        const filter = { mode: 'range', from: '2010-01-01', to: '2010-12-31' };
        const all = await albums.list({ album: 'family', filter });
        assert.equal(all.fallback, true);
        assert.equal(all.pictures?.length, 3);
        assert.equal(all.matched, 0);
        const none = await albums.list({ album: 'family', filter, fallback: false });
        assert.equal(none.pictures?.length, 0);
    });

    it('takes a selection of the day from a large album', async () => {
        const first = await albums.list({ album: 'family', limit: 2 });
        const again = await albums.list({ album: 'family', limit: 2 });
        assert.equal(first.pictures?.length, 2);
        assert.deepEqual(first.pictures, again.pictures);
    });

    it('answers for an unknown album and an unknown picture', async () => {
        assert.deepEqual(await albums.list({ album: 'nope' }), { error: 'album_not_found' });
        assert.deepEqual(await albums.picture({ album: 'family', key: '../etc/passwd' }), {
            error: 'picture_not_found',
        });
    });

    it('reduces a picture to the frame, once', async () => {
        const answer = await albums.picture({ album: 'family', key: 'a.jpg', width: 1200, height: 800 });
        assert.match(answer.url || '', /^screensaver\.0\/cache\/family\/[0-9a-f]{20}_1280\.jpg$/);
        const path = (answer.url || '').substring('screensaver.0/'.length);
        const copy = storage.files.get(path);
        assert.ok(copy);
        const meta = await sharp(copy).metadata();
        assert.deepEqual([meta.width, meta.height], [1280, 960]);
        const again = await albums.picture({ album: 'family', key: 'a.jpg', width: 1100, height: 700 });
        assert.equal(again.url, answer.url);
        assert.equal(storage.files.size, 1);
    });
});

describe('the cache of reduced pictures', () => {
    it('takes the next larger edge, up to the largest allowed', () => {
        assert.equal(edgeFor(1024, 600, 2560), 1280);
        assert.equal(edgeFor(1920, 1080, 2560), 1920);
        assert.equal(edgeFor(3840, 2160, 2560), 2560);
        assert.equal(edgeFor(0, 0, 2560), 960);
    });

    it('drops the copies used longest ago', async () => {
        const storage = memoryCache();
        let clock = 0;
        const cache = new PictureCache(storage, 'screensaver.0', null, 2500, () => ++clock);
        const source = {
            list: () => Promise.resolve([]),
            readHead: () => Promise.resolve(new Uint8Array(0)),
            read: () => Promise.resolve(Buffer.alloc(1000)),
        };
        const picture = (key: string): Picture => ({ key, name: `${key}.jpg` });
        await cache.get('a', picture('1'), source, 960);
        await cache.get('a', picture('2'), source, 960);
        // the first one is used again: the second is the oldest now
        await cache.get('a', picture('1'), source, 960);
        await cache.get('a', picture('3'), source, 960);
        assert.equal(storage.files.size, 2);
        assert.ok(cache.bytes <= 2500);
        const left = [...storage.files.keys()].sort();
        assert.equal(left.length, 2);
        assert.ok(left.every(path => path.startsWith(`${CACHE_FOLDER}/a/`)));
    });

    it('lets the browser load a small file of the storage as it is', async () => {
        const files = new Map<string, Buffer>([['fotos/klein.jpg', await photo(640, 480, '2024:01:02 03:04:05')]]);
        const storage: FileStorage = {
            readDir: () =>
                Promise.resolve([{ file: 'klein.jpg', isDir: false, size: files.get('fotos/klein.jpg').length }]),
            readFile: (_namespace, path) => Promise.resolve(files.get(path)),
            localPath: () => null,
        };
        const source = new StorageSource(storage, '0_userdata.0/fotos', false);
        const cache = new PictureCache(memoryCache(), 'screensaver.0', sharp, 1e9);
        const url = await cache.get(
            's',
            { key: 'klein.jpg', name: 'klein.jpg', size: 1000, width: 640, height: 480 },
            source,
            1280,
        );
        assert.equal(url, '0_userdata.0/fotos/klein.jpg');
    });
});

describe('dates in file names', () => {
    it('reads what phones and messengers write', () => {
        const text = (name: string): string | undefined => {
            const value = dateFromName(name);
            return value === undefined ? undefined : new Date(value).toISOString().substring(0, 19);
        };
        assert.equal(text('IMG_20241120_140312.jpg'), '2024-11-20T14:03:12');
        assert.equal(text('PXL_20241120_140312345.jpg'), '2024-11-20T14:03:12');
        assert.equal(text('IMG-20241120-WA0001.jpg'), '2024-11-20T12:00:00');
        assert.equal(text('2024-11-20 14.03.12.jpg'), '2024-11-20T14:03:12');
        assert.equal(text('Screenshot_20241120-140312.png'), '2024-11-20T14:03:12');
        assert.equal(text('DSC01234.jpg'), undefined);
        assert.equal(text('foto-99991231.jpg'), undefined);
    });
});

describe('Immich', () => {
    /**
     * A fake Immich
     *
     * @param routes - answers by `METHOD path`
     */
    function fakeImmich(
        routes: Record<string, (body: Record<string, unknown>) => { status?: number; json?: unknown; bytes?: Buffer }>,
    ): {
        fetch: typeof fetch;
        asked: string[];
    } {
        const asked: string[] = [];
        const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = new URL(input instanceof Request ? input.url : input);
            const key = `${init?.method || 'GET'} ${url.pathname}${url.search}`;
            asked.push(key);
            assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'secret');
            const route = routes[key];
            if (!route) {
                return Promise.resolve(new Response('not found', { status: 404 }));
            }
            const answer = route(init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {});
            if (answer.bytes) {
                return Promise.resolve(new Response(answer.bytes, { status: answer.status || 200 }));
            }
            return Promise.resolve(
                new Response(JSON.stringify(answer.json), {
                    status: answer.status || 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
        };
        return { fetch: fn, asked };
    }

    const asset = (id: string, extra: Partial<ImmichAsset> = {}): ImmichAsset => ({
        id,
        type: 'IMAGE',
        originalFileName: `${id}.jpg`,
        localDateTime: '2025-11-20T18:30:00.000Z',
        checksum: `sum-${id}`,
        exifInfo: { exifImageWidth: 4000, exifImageHeight: 3000, orientation: '6', city: 'Köln', country: 'Germany' },
        ...extra,
    });

    it('takes the wall-clock time, the turned size and the place of an asset', () => {
        const entry = assetToEntry(asset('a'));
        assert.equal(new Date(entry.date).toISOString(), '2025-11-20T18:30:00.000Z');
        assert.deepEqual([entry.width, entry.height], [3000, 4000]);
        assert.equal(entry.place, 'Köln, Germany');
        assert.equal(entry.known, true);
    });

    it('reads every page of an album found by its name', async () => {
        const pages: Record<number, ImmichAsset[]> = {
            1: [asset('a'), asset('b')],
            2: [asset('c', { isTrashed: true })],
        };
        const immich = fakeImmich({
            'GET /api/albums': () => ({ json: [{ id: 'f6a1c7c2-6d1e-4c8e-9a5e-0d3b1f2e4a5b', albumName: 'Familie' }] }),
            'POST /api/search/metadata': body => {
                assert.deepEqual(body.albumIds, ['f6a1c7c2-6d1e-4c8e-9a5e-0d3b1f2e4a5b']);
                const page = Number(body.page);
                return { json: { assets: { items: pages[page] || [], nextPage: page < 2 ? String(page + 1) : null } } };
            },
            'GET /api/assets/a/thumbnail?size=preview': () => ({ bytes: Buffer.from('preview') }),
        });
        const client = new ImmichClient('http://immich.local:2283/api/', 'secret', immich.fetch);
        const source = new ImmichSource(client, 'familie');
        const entries = await source.list();
        assert.deepEqual(
            entries.map(entry => entry.key),
            ['a', 'b'],
        );
        assert.equal((await source.read('a', 1280)).toString(), 'preview');
    });

    it('names the albums there are when the one of the settings is not among them', async () => {
        let albums = [{ id: 'f6a1c7c2-6d1e-4c8e-9a5e-0d3b1f2e4a5b', albumName: 'Familie' }];
        const immich = fakeImmich({ 'GET /api/albums': () => ({ json: albums }) });
        const client = new ImmichClient('http://immich.local:2283', 'secret', immich.fetch);
        // a path of the ioBroker files, typed where Immich wants the name of an album
        const source = new ImmichSource(client, '0_userdata.0.immich');
        await assert.rejects(source.list(), /no album "0_userdata\.0\.immich"; its albums: Familie$/);
        albums = [];
        await assert.rejects(source.list(), /no albums at all: leave the location empty/);
    });

    it('says why a key is refused', async () => {
        const immich = fakeImmich({
            'GET /api/users/me': () => ({ status: 401, json: { message: 'Invalid API key' } }),
        });
        const client = new ImmichClient('http://immich.local:2283', 'secret', immich.fetch);
        await assert.rejects(client.me(), /401.*API key/);
    });
});

describe('an album of Google Photos', () => {
    it('lists the chosen pictures by date and reduces them like the others', async () => {
        const jpeg = await photo(1920, 1440);
        const fetchFn = ((input: string | URL) => {
            const url = String(input);
            if (url.endsWith('/refresh')) {
                return Promise.resolve(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 })));
            }
            if (url.startsWith('https://photosambient.googleapis.com/v1/mediaItems')) {
                const mediaItems = [
                    {
                        id: 'x1',
                        createTime: '2025-11-20T10:00:00Z',
                        mediaFile: {
                            baseUrl: 'https://lh3.test/x1',
                            mimeType: 'image/jpeg',
                            mediaFileMetadata: { width: 4032, height: 3024 },
                        },
                    },
                    {
                        id: 'x2',
                        createTime: '2026-11-19T10:00:00Z',
                        mediaFile: {
                            baseUrl: 'https://lh3.test/x2',
                            mimeType: 'image/jpeg',
                            mediaFileMetadata: { width: 3024, height: 4032 },
                        },
                    },
                ];
                return Promise.resolve(new Response(JSON.stringify({ mediaItems })));
            }
            if (url.startsWith('https://lh3.test/')) {
                return Promise.resolve(new Response(jpeg));
            }
            return Promise.resolve(new Response('', { status: 404 }));
        }) as typeof fetch;
        const client = new AmbientClient(
            new GoogleSession(new OAuthProxy('https://oauth.test', fetchFn), 'rt'),
            fetchFn,
        );
        let connected = false;
        const google: GoogleAccess = {
            access: () => (connected ? { client, deviceId: 'dev1', sources: [] } : null),
            refreshSources: () => Promise.resolve([]),
        };
        const storage = memoryCache();
        const cache = new PictureCache(storage, 'screensaver.0', sharp, 1e9);
        const store = memoryStore();
        const albums = new Albums({
            storage: noStorage,
            immich: null,
            google,
            store,
            cache,
            log: quiet,
            maxEdge: 2560,
            now: () => new Date(2026, 10, 20, 9, 30),
        });
        assert.deepEqual(
            albums.configure([
                { enabled: true, id: 'gp', name: 'Google', type: 'google', location: '', recursive: false },
            ]),
            [],
        );

        // not connected yet: the album cannot be read
        assert.deepEqual(await albums.list({ album: 'gp' }), {
            error: 'album_failed',
            reason: 'Google Photos is not connected: connect it in the settings of the instance',
            total: 0,
        });

        connected = true;
        await albums.get('gp').scan();
        const answer = await albums.list({ album: 'gp', filter: { mode: 'lastDays', days: 7 }, fallback: false });
        assert.deepEqual(
            answer.pictures?.map(picture => [picture.k, picture.w, picture.h]),
            [['x2', 3024, 4032]],
        );
        const picture = await albums.picture({ album: 'gp', key: 'x2', width: 1200, height: 800 });
        assert.match(picture.url || '', /^screensaver\.0\/cache\/gp\/[0-9a-f]{20}_1280\.jpg$/);
        const copy = await sharp(storage.files.get(picture.url.replace('screensaver.0/', ''))).metadata();
        assert.equal(Math.max(copy.width, copy.height), 1280);
        assert.deepEqual(
            store.saved
                .get('gp')
                ?.map(stored => stored.key)
                .sort(),
            ['x1', 'x2'],
        );

        // disconnected: neither the copies nor the list of the media stay
        connected = false;
        await cache.forgetAlbum('gp');
        await albums.get('gp').forget();
        assert.equal(store.saved.has('gp'), false);
        assert.equal(
            [...storage.files.keys()].some(path => path.startsWith('cache/gp/')),
            false,
        );
        assert.deepEqual(await albums.list({ album: 'gp' }), {
            error: 'album_failed',
            reason: 'Google Photos is not connected: connect it in the settings of the instance',
            total: 0,
        });
    });

    it('does not store the list again when a scan ends after the access was withdrawn', async () => {
        let answer: (items: unknown) => void = () => undefined;
        let asked = false;
        const fetchFn = ((input: string | URL) => {
            const url = String(input);
            if (url.endsWith('/refresh')) {
                return Promise.resolve(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 })));
            }
            if (url.startsWith('https://photosambient.googleapis.com/v1/mediaItems')) {
                // the list comes late: after the disconnect
                asked = true;
                return new Promise<Response>(resolve => {
                    answer = items => resolve(new Response(JSON.stringify({ mediaItems: items })));
                });
            }
            return Promise.resolve(new Response('', { status: 404 }));
        }) as typeof fetch;
        const client = new AmbientClient(
            new GoogleSession(new OAuthProxy('https://oauth.test', fetchFn), 'rt'),
            fetchFn,
        );
        const store = memoryStore();
        const albums = new Albums({
            storage: noStorage,
            immich: null,
            google: {
                access: () => ({ client, deviceId: 'dev1', sources: [] }),
                refreshSources: () => Promise.resolve([]),
            },
            store,
            cache: new PictureCache(memoryCache(), 'screensaver.0', sharp, 1e9),
            log: quiet,
            maxEdge: 2560,
        });
        albums.configure([{ enabled: true, id: 'gp', name: 'Google', type: 'google', location: '', recursive: false }]);
        const index = albums.get('gp');
        const scan = index.scan();
        for (let i = 0; i < 100 && !asked; i++) {
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.ok(asked, 'the list of the media was asked for');
        await index.forget();
        answer([
            {
                id: 'late',
                createTime: '2026-11-19T10:00:00Z',
                mediaFile: { baseUrl: 'https://lh3.test/late', mimeType: 'image/jpeg' },
            },
        ]);
        await scan;
        assert.equal(index.size, 0);
        assert.equal(index.ready, false);
        assert.equal(store.saved.has('gp'), false);
    });
});
