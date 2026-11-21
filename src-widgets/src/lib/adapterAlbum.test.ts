/// <reference types="node" />
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { listRequest, parseWallClock, storageUrl, toPhotoRefs, type AdapterSocket } from './adapterAlbum';
import { readFrameConfig, readInstance } from './config';

describe('album of the adapter', () => {
    it('names the instance however it was stored', () => {
        assert.equal(readInstance(undefined), 'screensaver.0');
        assert.equal(readInstance('1'), 'screensaver.1');
        assert.equal(readInstance('system.adapter.screensaver.2'), 'screensaver.2');
        assert.equal(readInstance('screensaver.3'), 'screensaver.3');
        assert.equal(readInstance('nonsense'), 'screensaver.0');
    });

    it('asks for the album with the date filter of the settings', () => {
        const config = readFrameConfig({
            source: 'adapter',
            album: 'family',
            dateFilter: 'onThisDay',
            yearsAgo: '1',
            windowDays: 2,
        });
        assert.deepEqual(listRequest(config, 'family'), {
            album: 'family',
            filter: { mode: 'onThisDay', days: 30, from: '', to: '', yearsAgo: 1, windowDays: 2 },
            fallback: true,
        });
    });

    it('shows the wall-clock time of the picture as it was written', () => {
        const date = parseWallClock('2025-11-20T18:30:05');
        assert.ok(date);
        assert.deepEqual(
            [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()],
            [2025, 10, 20, 18, 30],
        );
        assert.equal(parseWallClock(undefined), undefined);
    });

    it('asks for the copy of a picture only when it is shown, in the size of the frame', async () => {
        const asked: unknown[] = [];
        const socket: AdapterSocket = {
            sendTo: (instance, command, data) => {
                asked.push([instance, command, data]);
                return Promise.resolve({ url: 'screensaver.0/cache/family/ab_1920.jpg' });
            },
        };
        const refs = toPhotoRefs(
            [{ k: 'urlaub/a b.jpg', d: '2024-07-14T18:22:05', p: 'Köln', c: 'Am Rhein' }, { k: 'x.jpg' }],
            socket,
            'screensaver.0',
            'family',
            '/files/',
        );
        assert.equal(refs.length, 2);
        assert.equal(refs[0].key, 'screensaver.0/family/urlaub/a b.jpg');
        assert.equal(refs[0].place, 'Köln');
        assert.equal(refs[0].caption, 'Am Rhein');
        assert.equal(refs[1].date, undefined);
        assert.equal(asked.length, 0);
        const url = await refs[0].resolve!({ width: 1800, height: 1000 }, new AbortController().signal);
        assert.equal(url, '/files/screensaver.0/cache/family/ab_1920.jpg');
        assert.deepEqual(asked, [
            ['screensaver.0', 'picture', { album: 'family', key: 'urlaub/a b.jpg', width: 1800, height: 1000 }],
        ]);
    });

    it('fails a picture the adapter cannot prepare', async () => {
        const socket: AdapterSocket = { sendTo: () => Promise.resolve({ error: 'picture_failed' }) };
        const [ref] = toPhotoRefs([{ k: 'a.jpg' }], socket, 'screensaver.0', 'family');
        await assert.rejects(ref.resolve!({ width: 100, height: 100 }, new AbortController().signal), /picture_failed/);
    });

    it('encodes every part of a path of the storage', () => {
        assert.equal(storageUrl('screensaver.0/cache/a b/c#d.jpg', '../'), '../screensaver.0/cache/a%20b/c%23d.jpg');
    });
});
