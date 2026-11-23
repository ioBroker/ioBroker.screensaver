import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PictureCache, type CacheStorage } from './pictureCache';
import type { PictureSource } from './sources';
import type { Picture } from './types';

/** A file storage in memory that tells what was written and deleted */
function memoryStorage(existing: { path: string; size: number; time: number }[] = []): CacheStorage & {
    files: Map<string, number>;
    deleted: string[];
} {
    const files = new Map<string, number>(existing.map(file => [file.path, file.size]));
    const deleted: string[] = [];
    return {
        files,
        deleted,
        write: (path, data) => {
            files.set(path, data.length);
            return Promise.resolve();
        },
        delete: path => {
            files.delete(path);
            deleted.push(path);
            return Promise.resolve();
        },
        list: () => Promise.resolve(existing),
    };
}

/** A source that counts how often it was read */
function countingSource(): PictureSource & { reads: number } {
    const source = {
        reads: 0,
        list: () => Promise.resolve([]),
        readHead: () => Promise.resolve(new Uint8Array(0)),
        read: (): Promise<Buffer> => {
            source.reads++;
            return Promise.resolve(Buffer.from([1, 2, 3]));
        },
    };
    return source;
}

const PICTURE: Picture = { key: 'k1', name: 'a.jpg', version: '1' };
const HOUR = 60 * 60_000;

describe('the cache of reduced pictures', () => {
    it('makes the copy of an album with a max age anew when it is too old', async () => {
        let time = 0;
        const storage = memoryStorage();
        const cache = new PictureCache(storage, 'screensaver.0', null, 1e9, () => time);
        await cache.init();
        cache.setMaxAge('google', HOUR);
        const source = countingSource();

        const first = await cache.get('google', PICTURE, source, 960);
        time += HOUR - 1;
        assert.equal(await cache.get('google', PICTURE, source, 960), first);
        assert.equal(source.reads, 1, 'still young: the copy is used');

        time += 1;
        assert.equal(await cache.get('google', PICTURE, source, 960), first);
        assert.equal(source.reads, 2, 'an hour old: read again from Google');
        assert.equal(cache.bytes, 3, 'the old copy is not counted twice');
    });

    it('deletes old copies of such albums on expire, and keeps the others', async () => {
        let time = 0;
        const storage = memoryStorage();
        const cache = new PictureCache(storage, 'screensaver.0', null, 1e9, () => time);
        await cache.init();
        cache.setMaxAge('google', HOUR);
        const source = countingSource();
        await cache.get('google', PICTURE, source, 960);
        await cache.get('family', PICTURE, source, 960);

        time += 2 * HOUR;
        await cache.expire();
        assert.equal(storage.deleted.length, 1);
        assert.match(storage.deleted[0], /^cache\/google\//);
        assert.equal(storage.files.size, 1);

        // without a max age the copies stay as long as there is room
        cache.setMaxAge('google', null);
        await cache.get('google', PICTURE, source, 960);
        time += 10 * HOUR;
        await cache.expire();
        assert.equal(storage.files.size, 2);
    });

    it('takes the time of the copies left from before as the time they were made', async () => {
        const time = 3 * HOUR;
        const storage = memoryStorage([
            { path: 'cache/google/old_960.jpg', size: 10, time: 0 },
            { path: 'cache/google/new_960.jpg', size: 10, time: 2.5 * HOUR },
        ]);
        const cache = new PictureCache(storage, 'screensaver.0', null, 1e9, () => time);
        await cache.init();
        cache.setMaxAge('google', HOUR);
        await cache.expire();
        assert.deepEqual(storage.deleted, ['cache/google/old_960.jpg']);
        assert.equal(cache.bytes, 10);
    });

    it('forgets all copies of a disconnected album', async () => {
        const storage = memoryStorage();
        const cache = new PictureCache(storage, 'screensaver.0', null, 1e9);
        await cache.init();
        const source = countingSource();
        await cache.get('google', PICTURE, source, 960);
        await cache.get('google', PICTURE, source, 1920);
        await cache.get('family', PICTURE, source, 960);
        await cache.forgetAlbum('google');
        assert.equal(storage.deleted.length, 2);
        assert.deepEqual(
            [...storage.files.keys()].map(path => path.split('/')[1]),
            ['family'],
        );
        assert.equal(cache.bytes, 3);
    });
});
