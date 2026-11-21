/**
 * The settings of a photo frame and of a screensaver, read out of the data of a widget.
 *
 * Both widgets are read in two places: by the widget itself, whose data vis-2 has already resolved, and by the
 * background service of the screensaver, which gets the data as the project stores it. A checkbox there may be
 * `true`, `'true'` or missing, a number may be a string, and an object ID that was never chosen is the literal
 * `nothing_selected`. Everything goes through here, so that both read the same.
 */

export type SourceKind = 'folder' | 'list' | 'state' | 'adapter';
export type DateFilterKind = 'all' | 'lastDays' | 'range' | 'onThisDay';
export type PlayOrder = 'sequential' | 'random';
export type TransitionKind = 'none' | 'fade' | 'slide';
export type FitKind = 'cover' | 'contain';
export type CaptionPosition = 'bottomLeft' | 'bottomRight' | 'off';
export type InfoPosition = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center';
export type PlaceSource = 'off' | 'exif' | 'osm';
export type ScreensaverScope = 'project' | 'view';

/** The object IDs of the weather card */
export interface WeatherOids {
    temperature: string;
    text: string;
    icon: string;
    wind: string;
    humidity: string;
    precipitation: string;
}

export interface FrameConfig {
    source: SourceKind;
    /** Folder in the file storage, like `0_userdata.0/fotos` or `_PRJ_NAME/fotos` */
    folder: string;
    /** Include the subfolders of `folder` */
    recursive: boolean;
    /** One URL per line, optionally followed by `| caption` */
    urls: string;
    /** State with a JSON list of pictures or a single URL */
    listOid: string;
    /** State whose value replaces `folder` (or `album` of the adapter), to switch the album */
    albumOid: string;
    /** `adapter`: the instance of the screensaver adapter, like `screensaver.0` */
    instance: string;
    /** `adapter`: the ID of the album, as configured in the instance */
    album: string;
    /** `adapter`: which days of the album are shown */
    dateFilter: DateFilterKind;
    /** `lastDays`: today and the days before */
    days: number;
    /** `range`: first and last day, `YYYY-MM-DD` */
    dateFrom: string;
    dateTo: string;
    /** `onThisDay`: 1 = today a year ago; 0 = this day in every year before */
    yearsAgo: number;
    /** `onThisDay`: days before and after that count too */
    windowDays: number;
    /** No picture matches the date filter: show the whole album instead of nothing */
    filterFallback: boolean;

    /** Seconds a picture stands */
    interval: number;
    order: PlayOrder;
    transition: TransitionKind;
    /** Seconds the transition takes */
    transitionTime: number;
    /** Slow zoom while a picture stands */
    kenBurns: boolean;
    fit: FitKind;
    /** Two portrait pictures side by side where the frame is landscape */
    pairPortraits: boolean;
    /** Dots for the position in the list */
    dots: boolean;

    captionPosition: CaptionPosition;
    showDate: boolean;
    placeSource: PlaceSource;
    /** The caption that comes with the picture: from the list or out of the file */
    showPhotoCaption: boolean;
    /** A text of its own, shown with every picture */
    captionText: string;

    infoPosition: InfoPosition;
    showClock: boolean;
    clockSeconds: boolean;
    clockDate: boolean;
    weather: WeatherOids;

    /** Swipe and tap to go on, go back and pause */
    interactive: boolean;
    nextOid: string;
    prevOid: string;
    pauseOid: string;

    /** No corners, frame and shadow: for a whole page */
    noCard: boolean;
}

export interface ScreensaverConfig extends FrameConfig {
    /** Minutes without input; 0 is never */
    timeout: number;
    scope: ScreensaverScope;
    /** The view to show when the screensaver ends; empty stays on the last one */
    afterView: string;
    /** `false` switches the screensaver off */
    enabledOid: string;
    /** `true` dims it to `dimLevel`, a number is the brightness in percent */
    dimOid: string;
    /** Brightness in percent while dimmed */
    dimLevel: number;
    /** Moving the mouse ends it, not only a click */
    endOnMouseMove: boolean;
}

type Data = Record<string, unknown>;

/**
 * An object ID, or an empty string where none was chosen
 *
 * @param value - what the widget carries
 */
export function cleanOid(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }
    const oid = value.trim();
    return oid && oid !== 'nothing_selected' ? oid : '';
}

/**
 * A checkbox: `true` and `'true'` are on, missing takes the default
 *
 * @param value - what the widget carries
 * @param def - what an untouched checkbox means
 */
export function readBool(value: unknown, def: boolean): boolean {
    if (value === undefined || value === null || value === '') {
        return def;
    }
    if (typeof value === 'string') {
        return value === 'true' || value === '1';
    }
    return !!value;
}

/**
 * A number between two limits; whatever is not one takes the default
 *
 * @param value - what the widget carries
 * @param def - the default
 * @param min - the smallest allowed value
 * @param max - the largest allowed value
 */
export function readNumber(value: unknown, def: number, min: number, max: number): number {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
    if (!isFinite(num)) {
        return def;
    }
    return Math.min(max, Math.max(min, num));
}

/**
 * One of a list of words; anything else takes the default
 *
 * @param value - what the widget carries
 * @param allowed - the words that are allowed
 * @param def - the default
 */
export function readEnum<T extends string>(value: unknown, allowed: readonly T[], def: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : def;
}

function readText(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

/** The adapter that keeps the albums */
export const ADAPTER_NAME = 'screensaver';

/**
 * The instance of the adapter: `screensaver.0`, also where only the number was stored
 *
 * @param value - what the widget carries
 */
export function readInstance(value: unknown): string {
    const text = readText(value).trim().replace(/^system\.adapter\./, '');
    if (/^\d+$/.test(text)) {
        return `${ADAPTER_NAME}.${text}`;
    }
    return /^[\w-]+\.\d+$/.test(text) ? text : `${ADAPTER_NAME}.0`;
}

/**
 * The settings of a photo frame
 *
 * @param data - the data of the widget
 * @param defaults - what differs for the screensaver: it shows the clock by default
 * @param defaults.showClock - the clock is on unless switched off
 */
export function readFrameConfig(data: Data | null | undefined, defaults?: { showClock?: boolean }): FrameConfig {
    const d: Data = data || {};
    return {
        source: readEnum(d.source, ['folder', 'list', 'state', 'adapter'] as const, 'folder'),
        folder: readText(d.folder).trim(),
        recursive: readBool(d.recursive, false),
        urls: readText(d.urls),
        listOid: cleanOid(d.listOid),
        albumOid: cleanOid(d.albumOid),
        instance: readInstance(d.instance),
        album: readText(d.album).trim(),
        dateFilter: readEnum(d.dateFilter, ['all', 'lastDays', 'range', 'onThisDay'] as const, 'all'),
        days: readNumber(d.days, 30, 1, 36600),
        dateFrom: readText(d.dateFrom).trim(),
        dateTo: readText(d.dateTo).trim(),
        yearsAgo: readNumber(d.yearsAgo, 1, 0, 200),
        windowDays: readNumber(d.windowDays, 0, 0, 14),
        filterFallback: readBool(d.filterFallback, true),

        interval: readNumber(d.interval, 10, 2, 86400),
        order: readEnum(d.order, ['sequential', 'random'] as const, 'sequential'),
        transition: readEnum(d.transition, ['none', 'fade', 'slide'] as const, 'fade'),
        transitionTime: readNumber(d.transitionTime, 1.5, 0.1, 10),
        kenBurns: readBool(d.kenBurns, true),
        fit: readEnum(d.fit, ['cover', 'contain'] as const, 'cover'),
        pairPortraits: readBool(d.pairPortraits, true),
        dots: readBool(d.dots, true),

        captionPosition: readEnum(d.captionPosition, ['bottomLeft', 'bottomRight', 'off'] as const, 'bottomLeft'),
        showDate: readBool(d.showDate, true),
        placeSource: readEnum(d.placeSource, ['off', 'exif', 'osm'] as const, 'exif'),
        showPhotoCaption: readBool(d.showPhotoCaption, true),
        captionText: readText(d.captionText).trim(),

        infoPosition: readEnum(
            d.infoPosition,
            ['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'center'] as const,
            'topRight',
        ),
        showClock: readBool(d.showClock, defaults?.showClock ?? false),
        clockSeconds: readBool(d.clockSeconds, false),
        clockDate: readBool(d.clockDate, true),
        weather: {
            temperature: cleanOid(d.weatherTempOid),
            text: cleanOid(d.weatherTextOid),
            icon: cleanOid(d.weatherIconOid),
            wind: cleanOid(d.weatherWindOid),
            humidity: cleanOid(d.weatherHumidityOid),
            precipitation: cleanOid(d.weatherPrecipOid),
        },

        interactive: readBool(d.interactive, true),
        nextOid: cleanOid(d.nextOid),
        prevOid: cleanOid(d.prevOid),
        pauseOid: cleanOid(d.pauseOid),

        noCard: readBool(d.noCard, false),
    };
}

/**
 * The settings of a screensaver
 *
 * @param data - the data of the widget, resolved or as the project stores it
 */
export function readScreensaverConfig(data: Data | null | undefined): ScreensaverConfig {
    const d: Data = data || {};
    const frame = readFrameConfig(d, { showClock: true });
    const afterView = Array.isArray(d.afterView) ? readText(d.afterView[0]) : readText(d.afterView);

    return {
        ...frame,
        // the screensaver covers the whole screen and is ended by a touch: there is no card and no navigation
        noCard: true,
        interactive: false,
        timeout: readNumber(d.timeout, 5, 0, 24 * 60),
        scope: readEnum(d.scope, ['project', 'view'] as const, 'project'),
        afterView: afterView.trim(),
        enabledOid: cleanOid(d.enabledOid),
        dimOid: cleanOid(d.dimOid),
        dimLevel: readNumber(d.dimLevel, 30, 0, 100),
        endOnMouseMove: readBool(d.endOnMouseMove, true),
    };
}

/** Is there a weather card to show at all? */
export function hasWeather(weather: WeatherOids): boolean {
    return !!(weather.temperature || weather.text || weather.icon);
}

/**
 * All object IDs a frame needs the values of
 *
 * @param config - the settings
 */
export function frameOids(config: FrameConfig): string[] {
    const oids = [
        config.source === 'state' ? config.listOid : '',
        config.source === 'folder' || config.source === 'adapter' ? config.albumOid : '',
        config.pauseOid,
        ...Object.values(config.weather),
    ];
    return [...new Set(oids.filter(Boolean))];
}
