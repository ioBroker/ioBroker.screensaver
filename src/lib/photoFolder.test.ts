import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { checkFolder, folderCheckAnswer, type FolderFs } from './photoFolder';

/**
 * A file system of a host like frigate: `/ssd` belongs to root, `/home/iobroker` to ioBroker, `/secret` is closed
 *
 * @param entries - path → what it is
 */
function fakeFs(entries: Record<string, 'dir' | 'file' | 'closed' | 'readOnlyDir'>): FolderFs {
    const fail = (code: string): Promise<never> => Promise.reject(Object.assign(new Error(code), { code }));
    return {
        stat: path => {
            // a closed folder above hides everything below it
            for (const [p, kind] of Object.entries(entries)) {
                if (kind === 'closed' && path.startsWith(`${p}/`)) {
                    return fail('EACCES');
                }
            }
            const kind = entries[path];
            return kind ? Promise.resolve({ isDirectory: () => kind !== 'file' }) : fail('ENOENT');
        },
        access: path => (entries[path] === 'dir' ? Promise.resolve() : fail('EACCES')),
    };
}

const FS = fakeFs({
    '/': 'readOnlyDir',
    '/ssd': 'readOnlyDir',
    '/ssd/immich': 'readOnlyDir',
    '/home': 'readOnlyDir',
    '/home/iobroker': 'dir',
    '/home/iobroker/photo.jpg': 'file',
    '/secret': 'closed',
});

describe('the folder of the photos', () => {
    it('tells whether the folder exists or ioBroker may create it', async () => {
        assert.deepEqual(await checkFolder('/ssd/immich', FS), { state: 'exists' });
        assert.deepEqual(await checkFolder(' /ssd/immich/ ', FS), { state: 'exists' });
        assert.deepEqual(await checkFolder('/home/iobroker/fotos/2026', FS), { state: 'willCreate' });
        // the case of frigate: /ssd belongs to root
        assert.deepEqual(await checkFolder('/ssd/fotos', FS), { state: 'cannotCreate', parent: '/ssd' });
        assert.deepEqual(await checkFolder('/media/usb/fotos', FS), { state: 'cannotCreate', parent: '/' });
        assert.deepEqual(await checkFolder('/home/iobroker/photo.jpg', FS), { state: 'notFolder' });
        assert.deepEqual(await checkFolder('/home/iobroker/photo.jpg/x', FS), { state: 'notFolder' });
        assert.deepEqual(await checkFolder('/secret/fotos', FS), { state: 'cannotCheck' });
        assert.deepEqual(await checkFolder('', FS), { state: 'none' });
        assert.deepEqual(await checkFolder('fotos', FS), { state: 'none' });
    });

    it('answers the settings in words, with the command where ioBroker may not create the folder', () => {
        const word = (key: string, ...args: string[]): string => `${key}(${args.join(',')})`;
        assert.deepEqual(folderCheckAnswer({ state: 'none' }, '', word), { text: '' });
        assert.equal(folderCheckAnswer({ state: 'exists' }, '/ssd/immich', word).text, 'immich_folder_exists()');
        const cannot = folderCheckAnswer({ state: 'cannotCreate', parent: '/ssd' }, '/ssd/fotos', word);
        assert.equal(cannot.text, 'immich_folder_cannot_create(/ssd)<br><code>sudo mkdir -p /ssd/fotos</code>');
        assert.equal(cannot.style?.color, '#f44336');
        assert.match(
            folderCheckAnswer({ state: 'cannotCheck' }, '/secret/<x>', word).text,
            /<code>sudo mkdir -p &#39;\/secret\/&#60;x&#62;&#39;<\/code>$/,
        );
    });
});
