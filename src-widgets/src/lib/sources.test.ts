/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    compareNames,
    isImageFile,
    listStorageFolder,
    parseDate,
    parseStateList,
    parseStorageFolder,
    parseUrlList,
    resolveUrl,
    sameList,
    storageFileUrl,
    type DirEntry,
} from './sources';

const PROJECT = '../vis-2.0/main';

void describe('resolveUrl', () => {
    void it('leads a file of the storage to the web server, relative to the page of vis-2', () => {
        assert.equal(resolveUrl('0_userdata.0/fotos/a.jpg', PROJECT), '../0_userdata.0/fotos/a.jpg');
        assert.equal(resolveUrl('vis-2.0/main/img/a.jpg', PROJECT), '../vis-2.0/main/img/a.jpg');
    });

    void it('puts the folder of the project in place of _PRJ_NAME', () => {
        assert.equal(resolveUrl('_PRJ_NAME/fotos/a.jpg', PROJECT), '../vis-2.0/main/fotos/a.jpg');
        assert.equal(resolveUrl('_PRJ_NAMEfotos/a.jpg', PROJECT), '../vis-2.0/main/fotos/a.jpg');
    });

    void it('leaves absolute and relative URLs as they are', () => {
        for (const url of ['https://example.com/a.jpg', '/vis-2/a.jpg', '../x/a.jpg', './a.jpg', 'data:image/png;base64,AA']) {
            assert.equal(resolveUrl(url, PROJECT), url);
        }
        assert.equal(resolveUrl('   ', PROJECT), '');
    });
});

void describe('storage folders', () => {
    void it('splits what was typed into the object and the path', () => {
        assert.deepEqual(parseStorageFolder('0_userdata.0/fotos', 'vis-2.0/main'), { namespace: '0_userdata.0', path: 'fotos' });
        assert.deepEqual(parseStorageFolder('/0_userdata.0/fotos/2024/', 'vis-2.0/main'), {
            namespace: '0_userdata.0',
            path: 'fotos/2024',
        });
        assert.deepEqual(parseStorageFolder('../0_userdata.0\\fotos', 'vis-2.0/main'), { namespace: '0_userdata.0', path: 'fotos' });
        assert.deepEqual(parseStorageFolder('_PRJ_NAME/fotos', 'vis-2.0/main'), { namespace: 'vis-2.0', path: 'main/fotos' });
        assert.deepEqual(parseStorageFolder('0_userdata.0', 'vis-2.0/main'), { namespace: '0_userdata.0', path: '' });
        assert.equal(parseStorageFolder('  ', 'vis-2.0/main'), null);
        assert.equal(parseStorageFolder('/', 'vis-2.0/main'), null);
    });

    void it('encodes every part of the URL of a file', () => {
        assert.equal(
            storageFileUrl({ namespace: '0_userdata.0', path: 'fotos' }, 'Urlaub 2024/Strand #1.jpg'),
            '../0_userdata.0/fotos/Urlaub%202024/Strand%20%231.jpg',
        );
        assert.equal(storageFileUrl({ namespace: '0_userdata.0', path: '' }, 'a.jpg'), '../0_userdata.0/a.jpg');
    });

    void it('knows picture files', () => {
        assert.equal(isImageFile('IMG_0001.JPG'), true);
        assert.equal(isImageFile('a.webp'), true);
        assert.equal(isImageFile('a.heic'), false);
        assert.equal(isImageFile('notes.txt'), false);
    });

    void it('sorts names like a person', () => {
        const names = ['IMG_10.jpg', 'IMG_2.jpg', 'img_1.jpg'];
        assert.deepEqual(names.sort(compareNames), ['img_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
    });

    const tree: Record<string, DirEntry[]> = {
        fotos: [
            { file: 'b.jpg', isDir: false },
            { file: 'a.jpg', isDir: false },
            { file: 'notes.txt', isDir: false },
            { file: '.hidden.jpg', isDir: false },
            { file: '@eaDir', isDir: true },
            { file: 'sub', isDir: true },
        ],
        'fotos/sub': [{ file: 'c.png', isDir: false }],
        'fotos/@eaDir': [{ file: 'thumb.jpg', isDir: false }],
    };
    const readDir = (namespace: string, path: string): Promise<DirEntry[]> => {
        assert.equal(namespace, '0_userdata.0');
        return tree[path] ? Promise.resolve(tree[path]) : Promise.reject(new Error('Not exists'));
    };
    const folder = { namespace: '0_userdata.0', path: 'fotos' };

    void it('lists the pictures of a folder, sorted, without hidden files', async () => {
        const list = await listStorageFolder(readDir, folder, false);
        assert.deepEqual(
            list.map(ref => ref.url),
            ['../0_userdata.0/fotos/a.jpg', '../0_userdata.0/fotos/b.jpg'],
        );
        assert.equal(list[0].key, list[0].url);
    });

    void it('with subfolders, but not the thumbnails of a NAS', async () => {
        const list = await listStorageFolder(readDir, folder, true);
        assert.deepEqual(
            list.map(ref => ref.url),
            ['../0_userdata.0/fotos/a.jpg', '../0_userdata.0/fotos/b.jpg', '../0_userdata.0/fotos/sub/c.png'],
        );
    });

    void it('fails when the folder itself does not exist', async () => {
        await assert.rejects(listStorageFolder(readDir, { namespace: '0_userdata.0', path: 'nothing' }, true));
    });
});

void describe('parseUrlList', () => {
    void it('reads one picture per line with an optional caption, and skips comments and doubles', () => {
        const list = parseUrlList(
            '# holidays\nhttps://example.com/a.jpg | At the sea\r\n\n0_userdata.0/b.jpg\nhttps://example.com/a.jpg\n',
            PROJECT,
        );
        assert.deepEqual(list, [
            { key: 'https://example.com/a.jpg', url: 'https://example.com/a.jpg', caption: 'At the sea' },
            { key: '../0_userdata.0/b.jpg', url: '../0_userdata.0/b.jpg', caption: undefined },
        ]);
        assert.deepEqual(parseUrlList('', PROJECT), []);
    });
});

void describe('parseDate', () => {
    void it('reads EXIF, ISO, milliseconds and seconds', () => {
        assert.equal(parseDate('2023:07:14 18:22:05')?.getTime(), new Date(2023, 6, 14, 18, 22, 5).getTime());
        assert.equal(parseDate('2023-07-14')?.getTime(), new Date(2023, 6, 14, 12, 0, 0).getTime());
        assert.equal(parseDate('2023-07-14T18:22:05Z')?.toISOString(), '2023-07-14T18:22:05.000Z');
        assert.equal(parseDate(1689358925000)?.getTime(), 1689358925000);
        assert.equal(parseDate(1689358925)?.getTime(), 1689358925000);
        assert.equal(parseDate('1689358925')?.getTime(), 1689358925000);
    });

    void it('gives nothing for what is no date', () => {
        assert.equal(parseDate('yesterday'), undefined);
        assert.equal(parseDate(''), undefined);
        assert.equal(parseDate(0), undefined);
        assert.equal(parseDate(null), undefined);
        assert.equal(parseDate(new Date(NaN)), undefined);
    });
});

void describe('parseStateList', () => {
    void it('reads a single URL and a list of lines', () => {
        assert.deepEqual(
            parseStateList('https://example.com/a.jpg', PROJECT).map(ref => ref.url),
            ['https://example.com/a.jpg'],
        );
        assert.deepEqual(
            parseStateList('0_userdata.0/a.jpg\n0_userdata.0/b.jpg', PROJECT).map(ref => ref.url),
            ['../0_userdata.0/a.jpg', '../0_userdata.0/b.jpg'],
        );
    });

    void it('reads the JSON list of the requirement: url, date, place, caption', () => {
        const list = parseStateList(
            JSON.stringify([
                { url: 'https://example.com/a.jpg', date: '2024-08-03T10:00:00Z', place: 'Split', caption: 'Beach' },
                'https://example.com/b.jpg',
                { nothing: true },
            ]),
            PROJECT,
        );
        assert.equal(list.length, 2);
        assert.equal(list[0].place, 'Split');
        assert.equal(list[0].caption, 'Beach');
        assert.equal(list[0].date?.toISOString(), '2024-08-03T10:00:00.000Z');
        assert.equal(list[1].url, 'https://example.com/b.jpg');
    });

    void it('takes the field names of other tools generously', () => {
        const list = parseStateList(
            { photos: [{ src: '_PRJ_NAME/x.jpg', title: 'X', takenAt: 1689358925, location: 'Wien' }] },
            PROJECT,
        );
        assert.deepEqual(list[0].url, '../vis-2.0/main/x.jpg');
        assert.equal(list[0].caption, 'X');
        assert.equal(list[0].place, 'Wien');
        assert.equal(list[0].date?.getTime(), 1689358925000);
    });

    void it('gives an empty list for broken JSON and empty values', () => {
        assert.deepEqual(parseStateList('[{"url": ', PROJECT), []);
        assert.deepEqual(parseStateList('', PROJECT), []);
        assert.deepEqual(parseStateList(null, PROJECT), []);
        assert.deepEqual(parseStateList(42, PROJECT), []);
    });
});

void describe('sameList', () => {
    void it('compares pictures, order and captions', () => {
        const a = parseUrlList('x.jpg|one\ny.jpg', PROJECT);
        assert.equal(sameList(a, parseUrlList('x.jpg|one\ny.jpg', PROJECT)), true);
        assert.equal(sameList(a, parseUrlList('y.jpg\nx.jpg|one', PROJECT)), false);
        assert.equal(sameList(a, parseUrlList('x.jpg|two\ny.jpg', PROJECT)), false);
        assert.equal(sameList(a, a.slice(0, 1)), false);
    });
});
