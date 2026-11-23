/**
 * The weather of a weather adapter, found by the roles of its states.
 *
 * Instead of six object IDs the user picks one source: the channel of a weather adapter with the current weather,
 * like `open-meteo-weather.0.Boat.weather.current` or `openweathermap.0.forecast.current`. The states of the card
 * are looked up there by their roles. An object ID of the settings wins over the state found, so that a
 * temperature measured outside replaces the one of the weather service.
 *
 * No React and no browser here: the adapter lists the sources with the same rules, for the settings of the web
 * components.
 */

export type WeatherSlot = 'temperature' | 'text' | 'icon' | 'wind' | 'humidity' | 'precipitation';

export const WEATHER_SLOTS: readonly WeatherSlot[] = [
    'temperature',
    'text',
    'icon',
    'wind',
    'humidity',
    'precipitation',
];

/** An object ID per value of the card; empty where there is none */
export type WeatherStates = Record<WeatherSlot, string>;

/** What matters of an object */
export interface ObjectLike {
    type?: string;
    common?: { role?: unknown; type?: unknown; unit?: unknown } | null;
}

export type ObjectMap = Record<string, ObjectLike | null | undefined>;

/**
 * The objects of one type whose IDs lie between `start` and `end`: `getObjectViewSystem` of the connection in the
 * browser, `getObjectViewAsync` in the adapter
 */
export type ObjectView = (type: 'instance' | 'state', start: string, end: string) => Promise<ObjectMap>;

export interface WeatherSourceOption {
    value: string;
    label: string;
}

/** What a source gives: the states found, and the units their objects name */
export interface FoundWeather {
    states: Partial<WeatherStates>;
    units: Record<string, string>;
}

export const NO_WEATHER: FoundWeather = { states: {}, units: {} };

/** The last ID of a range: everything that starts with what comes before it */
const LAST = '香';

/** Parts of an ID that say nothing about the place the weather is of */
const GENERIC = new Set(['weather', 'current', 'forecast', 'now', 'actual', 'data', 'info']);

/** Not more sources of one instance than this in the list */
const MAX_SOURCES = 20;

/** Words of a state with the weather as a text, where the role does not say it (open-meteo: `text`) */
const TEXT_NAME = /^(weather_?text|weather_?description|description|condition|summary)$/;

const isCurrentPart = (part: string): boolean => /^(current|now)$/i.test(part);

/**
 * How well a state fits a value of the card: 0 is best, `null` not at all
 *
 * @param slot - the value of the card
 * @param id - the object ID
 * @param obj - the object
 */
export function slotRank(slot: WeatherSlot, id: string, obj: ObjectLike | null | undefined): number | null {
    const common = obj?.common;
    if (!common || (obj.type && obj.type !== 'state')) {
        return null;
    }
    const role = typeof common.role === 'string' ? common.role.toLowerCase() : '';
    const type = typeof common.type === 'string' ? common.type : '';
    const name = id.substring(id.lastIndexOf('.') + 1).toLowerCase();
    switch (slot) {
        case 'temperature':
            // not `.feelslike`, `.dewpoint`, `.max` and the like
            return role === 'value.temperature' ? 0 : null;
        case 'text':
            // a number is a code: open-meteo writes the WMO code into `weather.state`
            if (type === 'number' || type === 'boolean') {
                return null;
            }
            if (role === 'weather.state') {
                return 0;
            }
            if (TEXT_NAME.test(name)) {
                return 1;
            }
            return role === 'weather.title' ? 2 : null;
        case 'icon':
            // the card draws its own symbol for a WMO code, and shows the picture of the adapter otherwise
            if (role === 'weather.state' && type === 'number') {
                return 0;
            }
            return role === 'weather.icon' || role === 'weather.icon.url' || role === 'weather.icon.name' ? 1 : null;
        case 'wind':
            return role === 'value.speed.wind' ? 0 : null;
        case 'humidity':
            return role === 'value.humidity' ? 0 : null;
        case 'precipitation':
            if (role !== 'value.precipitation' && role !== 'weather.precipitation') {
                return null;
            }
            // open-meteo has `showers` with the same role
            return name === 'precipitation' ? 0 : 1;
    }
    return null;
}

/** A state that fits a value of the card, and how well */
interface Scored {
    score: number[];
    id: string;
}

/**
 * Is score `a` better than score `b`? Lower numbers first, then the ID
 *
 * @param a - a score and its ID
 * @param b - another one
 */
function better(a: Scored, b: Scored): boolean {
    for (let i = 0; i < a.score.length; i++) {
        if (a.score[i] !== b.score[i]) {
            return a.score[i] < b.score[i];
        }
    }
    return a.id < b.id;
}

/**
 * The states of the card below a source. The current weather wins over a forecast, a fitting role over a fitting
 * name, a state close to the source over a deep one.
 *
 * @param root - the source, like `openweathermap.0.forecast.current`
 * @param objects - the states below it
 */
export function pickWeatherStates(root: string, objects: ObjectMap): Partial<WeatherStates> {
    const prefix = `${root}.`;
    const best: Partial<Record<WeatherSlot, Scored>> = {};
    for (const [id, obj] of Object.entries(objects)) {
        if (!id.startsWith(prefix)) {
            continue;
        }
        const parts = id.substring(prefix.length).split('.');
        const current = parts.slice(0, -1).some(isCurrentPart) || parts.length === 1 ? 0 : 1;
        for (const slot of WEATHER_SLOTS) {
            const rank = slotRank(slot, id, obj);
            if (rank === null) {
                continue;
            }
            const candidate = { score: [current, rank, parts.length], id };
            const old = best[slot];
            if (!old || better(candidate, old)) {
                best[slot] = candidate;
            }
        }
    }
    const result: Partial<WeatherStates> = {};
    for (const slot of WEATHER_SLOTS) {
        const found = best[slot];
        if (found) {
            result[slot] = found.id;
        }
    }
    return result;
}

/**
 * The object IDs of the card: the ones of the settings, and for the others the states of the source
 *
 * @param own - the object IDs of the settings
 * @param found - the states of the source
 */
export function mergeWeather(own: WeatherStates, found: Partial<WeatherStates>): WeatherStates {
    const result = { ...own };
    for (const slot of WEATHER_SLOTS) {
        result[slot] = own[slot] || found[slot] || '';
    }
    return result;
}

/**
 * The name of a source in a list: the instance, and the place if the adapter keeps more than one
 *
 * @param instance - like `open-meteo-weather.0`
 * @param channel - like `open-meteo-weather.0.Boat.weather.current`
 */
function sourceLabel(instance: string, channel: string): string {
    const place = channel
        .substring(instance.length + 1)
        .split('.')
        .filter(part => part && !GENERIC.has(part.toLowerCase()))
        .join(' / ');
    return place ? `${instance} · ${place}` : instance;
}

/**
 * Where a weather adapter keeps the current weather: the channels with a temperature. If some of them are the
 * current weather (a part `current`), only those - a forecast per hour has a temperature too.
 *
 * @param instance - like `open-meteo-weather.0`
 * @param objects - the states of the instance
 */
export function findWeatherSources(instance: string, objects: ObjectMap): WeatherSourceOption[] {
    const prefix = `${instance}.`;
    const channels = new Set<string>();
    for (const [id, obj] of Object.entries(objects)) {
        if (id.startsWith(prefix) && slotRank('temperature', id, obj) !== null) {
            channels.add(id.substring(0, id.lastIndexOf('.')));
        }
    }
    const depth = (channel: string): number => channel.split('.').length;
    let list = [...channels];
    const current = list.filter(channel => channel.substring(prefix.length).split('.').some(isCurrentPart));
    if (current.length) {
        list = current;
    } else if (list.length) {
        const min = Math.min(...list.map(depth));
        list = list.filter(channel => depth(channel) === min);
    }
    list = list.sort().slice(0, MAX_SOURCES);

    const labels = list.map(channel => sourceLabel(instance, channel));
    return list.map((value, i) => ({
        value,
        // two places of the same name: the whole path tells them apart
        label:
            labels.indexOf(labels[i]) !== labels.lastIndexOf(labels[i])
                ? `${instance} · ${value.substring(prefix.length)}`
                : labels[i],
    }));
}

/**
 * The sources of all weather adapters (`common.type` `weather`) of the installation
 *
 * @param view - reads objects
 */
export async function listWeatherSources(view: ObjectView): Promise<WeatherSourceOption[]> {
    const instances = await view('instance', 'system.adapter.', `system.adapter.${LAST}`);
    const result: WeatherSourceOption[] = [];
    const ids = Object.keys(instances).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const id of ids) {
        const common = instances[id]?.common;
        if (common?.type !== 'weather') {
            continue;
        }
        const instance = id.substring('system.adapter.'.length);
        try {
            result.push(...findWeatherSources(instance, await view('state', `${instance}.`, `${instance}.${LAST}`)));
        } catch {
            // an instance whose objects cannot be read is no source
        }
    }
    return result;
}

/**
 * The states of the card below a source, with their units. A source that is a state itself (an ID picked by
 * hand) stands for the channel it is in.
 *
 * @param view - reads objects
 * @param source - the channel, like `openweathermap.0.forecast.current`
 */
export async function resolveWeatherSource(view: ObjectView, source: string): Promise<FoundWeather> {
    let root = source.trim().replace(/\.+$/, '');
    if (!root) {
        return NO_WEATHER;
    }
    let objects = await view('state', `${root}.`, `${root}.${LAST}`);
    if (!Object.keys(objects).length && root.includes('.')) {
        root = root.substring(0, root.lastIndexOf('.'));
        objects = await view('state', `${root}.`, `${root}.${LAST}`);
    }
    const states = pickWeatherStates(root, objects);
    const units: Record<string, string> = {};
    for (const id of Object.values(states)) {
        const unit = objects[id]?.common?.unit;
        if (typeof unit === 'string' && unit.trim()) {
            units[id] = unit.trim();
        }
    }
    return { states, units };
}
