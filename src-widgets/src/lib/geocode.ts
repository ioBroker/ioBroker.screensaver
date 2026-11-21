/**
 * The name of the place where a photo was taken, out of its GPS coordinates.
 *
 * A phone writes coordinates and no names, so "where" needs a lookup. It is done at OpenStreetMap (Nominatim)
 * and only where the user switched it on: it tells a server outside the house where the family has been. The
 * answers are kept in the browser, rounded to about a kilometre, so every place is asked for once, and the
 * requests are spaced as the usage policy of Nominatim asks for.
 */

const CACHE_PREFIX = 'vis2screensaver.place.';

/** Nominatim allows one request per second */
const SPACING_MS = 1100;

const pending = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

function cacheKey(lat: number, lon: number, lang: string): string {
    return `${CACHE_PREFIX}${lat.toFixed(2)},${lon.toFixed(2)},${lang}`;
}

function readCache(key: string): string | null | undefined {
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? undefined : value || null;
    } catch {
        return undefined;
    }
}

function writeCache(key: string, value: string | null): void {
    try {
        window.localStorage.setItem(key, value || '');
    } catch {
        // full or not allowed: then it is asked again next time
    }
}

interface NominatimAddress {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
}

/**
 * City and country out of an answer of Nominatim
 *
 * @param address - the `address` of the answer
 */
export function placeOfAddress(address: NominatimAddress | undefined): string | null {
    if (!address) {
        return null;
    }
    const local = address.city || address.town || address.village || address.hamlet || address.municipality || address.county || address.state;
    const parts = [local, address.country].filter((part): part is string => !!part);
    return parts.length ? [...new Set(parts)].join(', ') : null;
}

/**
 * Look the place up, or take it from the cache
 *
 * @param lat - latitude
 * @param lon - longitude
 * @param lang - the language of the answer
 */
export function lookupPlace(lat: number, lon: number, lang: string): Promise<string | null> {
    const key = cacheKey(lat, lon, lang);
    const cached = readCache(key);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }
    const running = pending.get(key);
    if (running) {
        return running;
    }
    const request = new Promise<string | null>(resolve => {
        // one after the other, with a pause after each: the answer is passed on at once, the pause is the queue's
        queue = queue.then(async () => {
            const url =
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10` +
                `&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&accept-language=${encodeURIComponent(lang)}`;
            try {
                const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'origin' });
                const data = response.ok ? ((await response.json()) as { address?: NominatimAddress }) : null;
                const place = placeOfAddress(data?.address);
                writeCache(key, place);
                resolve(place);
            } catch {
                // offline: no place, and asked again next time
                resolve(null);
            }
            await new Promise(done => setTimeout(done, SPACING_MS));
        });
    });
    pending.set(key, request);
    void request.finally(() => pending.delete(key));
    return request;
}
