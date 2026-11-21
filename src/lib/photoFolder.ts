/**
 * The folder of the photos of Immich in Docker, seen from the host of the instance: does it exist, may ioBroker
 * create it. Docker does not create the source of a bind mount, and ioBroker runs as a user that often may not write
 * below a mounted disk like `/ssd` - the settings tell it while the folder is chosen, not only after saving.
 */

import { constants, promises as fsp } from 'node:fs';
import { posix } from 'node:path';

import { escapeHtml } from './html';
import { shellQuote, type Words } from './immichDocker';

export type FolderCheck =
    /** Empty or not a full path: the validator of the field tells that */
    | { state: 'none' }
    | { state: 'exists' }
    /** A file is in the way */
    | { state: 'notFolder' }
    /** It does not exist yet, and ioBroker may create it */
    | { state: 'willCreate' }
    /** It does not exist, and ioBroker may not write into `parent`, the nearest folder above that exists */
    | { state: 'cannotCreate'; parent: string }
    /** ioBroker may not even look: a folder above is closed to it. It may exist for Docker all the same */
    | { state: 'cannotCheck' };

/** The part of `fs.promises` the check needs */
export interface FolderFs {
    stat(path: string): Promise<{ isDirectory(): boolean }>;
    access(path: string, mode: number): Promise<void>;
}

function errorCode(e: unknown): unknown {
    return (e as { code?: unknown } | null)?.code;
}

/**
 * Check the folder of the photos
 *
 * @param folder - full path on the host (Linux)
 * @param fs - the file system, for tests
 */
export async function checkFolder(folder: string, fs: FolderFs = fsp): Promise<FolderCheck> {
    if (!folder.trim().startsWith('/')) {
        return { state: 'none' };
    }
    // without a slash at the end: dirname('/ssd/immich/') is '/ssd', one folder too high
    const path = posix.normalize(folder.trim()).replace(/(.)\/+$/, '$1');
    try {
        return (await fs.stat(path)).isDirectory() ? { state: 'exists' } : { state: 'notFolder' };
    } catch (e) {
        if (errorCode(e) !== 'ENOENT') {
            return { state: 'cannotCheck' };
        }
    }
    // the nearest folder above that exists: may ioBroker create the rest in it?
    let parent = path;
    for (;;) {
        const up = posix.dirname(parent);
        if (up === parent) {
            break;
        }
        parent = up;
        try {
            if (!(await fs.stat(parent)).isDirectory()) {
                return { state: 'notFolder' };
            }
            break;
        } catch (e) {
            if (errorCode(e) !== 'ENOENT') {
                return { state: 'cannotCheck' };
            }
        }
    }
    try {
        await fs.access(parent, constants.W_OK | constants.X_OK);
        return { state: 'willCreate' };
    } catch {
        return { state: 'cannotCreate', parent };
    }
}

/** The answer for the `textSendTo` control below the folder field of the settings */
export interface FolderCheckAnswer {
    text: string;
    style?: Record<string, string>;
    icon?: string;
}

const GOOD = { color: '#4caf50' };
const BAD = { color: '#f44336' };
const UNSURE = { color: '#ff9800' };

/**
 * The result of the check in words, as HTML
 *
 * @param check - the result of `checkFolder`
 * @param folder - the folder of the settings
 * @param word - the words
 */
export function folderCheckAnswer(check: FolderCheck, folder: string, word: Words): FolderCheckAnswer {
    const command = `<br><code>sudo mkdir -p ${escapeHtml(shellQuote(folder.trim()))}</code>`;
    switch (check.state) {
        case 'none':
            return { text: '' };
        case 'exists':
            return { text: escapeHtml(word('immich_folder_exists')), style: GOOD };
        case 'willCreate':
            return { text: escapeHtml(word('immich_folder_will_create')), style: GOOD };
        case 'notFolder':
            return { text: escapeHtml(word('immich_folder_not_folder')), style: BAD };
        case 'cannotCreate':
            return { text: escapeHtml(word('immich_folder_cannot_create', check.parent)) + command, style: BAD };
        case 'cannotCheck':
            return { text: escapeHtml(word('immich_folder_cannot_check')) + command, style: UNSURE };
    }
}
