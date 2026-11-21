/**
 * Where the file storage of ioBroker is, seen from a web component.
 *
 * vis-2 knows its page: `/vis-2/index.html` of the web server, which serves a file of the storage as
 * `/<object>/<path>`, so `../0_userdata.0/fotos/a.jpg` finds it. A web component runs on pages it does not know:
 * vis-2 and Aura (web), devices as a page of web (`/devices/`) or as a tab of admin (`/adapter/devices/tab.html`).
 * Admin serves the storage as `/files/<object>/<path>`, web as `/<object>/<path>`.
 *
 * What both have in common is the module itself: the host imports it from `<base>/adapter/<adapter>/webcomponents/`,
 * so `<base>` is known - with the path of a reverse proxy, if there is one. Whether that server is admin or web is
 * asked once per page, with the icon of this adapter, which lies in the storage as `<adapter>.admin/<adapter>.svg`.
 */

import { ADAPTER } from './constants';

/**
 * The base of the server the module came from
 *
 * @param moduleUrl - the URL of the module, `<base>/adapter/<adapter>/webcomponents/<file>.js`
 * @returns `<base>/`, ending with a slash
 */
export function serverBase(moduleUrl: string): string {
    const pos = moduleUrl.lastIndexOf('/adapter/');
    if (pos !== -1) {
        return moduleUrl.substring(0, pos + 1);
    }
    // loaded from somewhere else - a dev server: the root of the page
    return new URL('/', moduleUrl).href;
}

/**
 * Does this URL deliver our icon? A login page of a server with authentication answers with HTML and 200.
 *
 * @param url - the URL of the icon
 */
async function deliversIcon(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
        return response.ok && (response.headers.get('content-type') || '').includes('svg');
    } catch {
        return false;
    }
}

/**
 * Where the storage is served on the server of the module
 *
 * @param base - the server, from {@link serverBase}
 * @returns `<base>/` for web, `<base>/files/` for admin
 */
export async function findFilesUrl(base: string): Promise<string> {
    const icon = `${ADAPTER}.admin/${ADAPTER}.svg`;
    if (await deliversIcon(`${base}${icon}`)) {
        return base;
    }
    if (await deliversIcon(`${base}files/${icon}`)) {
        return `${base}files/`;
    }
    // neither answered: web is where pictures are shown far more often
    return base;
}

let filesUrl: Promise<string> | null = null;

/** Where the storage is served, asked once per page */
export function getFilesUrl(): Promise<string> {
    filesUrl ||= findFilesUrl(serverBase(import.meta.url));
    return filesUrl;
}
