/**
 * The card of Immich in the quick access of admin ("Intro"): an entry of `common.localLinks` of the instance.
 *
 * Admin builds the cards from the instance object, so the adapter writes the entry there when Immich is set up and
 * removes it when not. A change of the instance object restarts the instance: it is written only when it changes.
 */

import type { ImmichDockerSettings } from './immichDocker';

/** The name of the entry in `common.localLinks`: other entries stay as they are */
export const IMMICH_LINK_KEY = 'immich';

type LocalLinks = Record<string, string | ioBroker.LocalLink>;

const DESCRIPTION: ioBroker.Translated = {
    en: 'The photo library of the screensaver',
    de: 'Die Fotobibliothek des Bildschirmschoners',
    ru: 'Фотобиблиотека заставки',
    pt: 'A fototeca da proteção de ecrã',
    nl: 'De fotobibliotheek van de schermbeveiliging',
    fr: "La photothèque de l'économiseur d'écran",
    it: 'La fototeca del salvaschermo',
    es: 'La fototeca del salvapantallas',
    pl: 'Biblioteka zdjęć wygaszacza ekranu',
    uk: 'Фотобібліотека заставки',
    'zh-cn': '屏幕保护程序的照片库',
};

/**
 * Where the browser finds Immich; null without Immich, or when it only listens on its own host
 *
 * @param docker - the settings of Immich in Docker
 * @param immichUrl - the URL of an Immich of its own
 */
export function immichLink(
    docker: Pick<ImmichDockerSettings, 'enabled' | 'bind' | 'port'>,
    immichUrl: string | undefined,
): string | null {
    if (docker.enabled) {
        const bind = docker.bind || '0.0.0.0';
        if (bind.startsWith('127.') || bind === '::1' || bind === 'localhost') {
            return null;
        }
        // in place of %ip% admin puts the address of the host of the instance, as the browser reaches it
        const host = bind === '0.0.0.0' || bind === '::' ? '%ip%' : bind.includes(':') ? `[${bind}]` : bind;
        return `http://${host}:${docker.port}`;
    }
    const url = (immichUrl || '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/api$/, '');
    if (!/^https?:\/\/[^/]/i.test(url)) {
        return null;
    }
    // `localhost` is the host of the adapter, not the one of the browser
    return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i, '$1%ip%');
}

/**
 * `common.localLinks` with the card of Immich, or without it
 *
 * @param links - the links of the instance now
 * @param link - where Immich is; null for none
 * @returns the links; undefined if none are left
 */
export function withImmichLink(links: LocalLinks | undefined, link: string | null): LocalLinks | undefined {
    const result: LocalLinks = { ...links };
    if (link) {
        result[IMMICH_LINK_KEY] = { link, name: 'Immich', description: DESCRIPTION, intro: true };
    } else {
        delete result[IMMICH_LINK_KEY];
    }
    return Object.keys(result).length ? result : undefined;
}
