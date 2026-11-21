/**
 * The manifests of the web components. Read by the build only (`vite.wc.config.ts`), which writes them as JSON next
 * to the modules - a host reads that file for its palette and its settings without loading the module.
 *
 * The settings are those of the vis-2 widgets (`lib/attributes.ts`), with the same names, so that `lib/config.ts`
 * reads both alike; the words come from the dictionaries of the set. Left out is what only vis-2 has: views,
 * the project folder `_PRJ_NAME`, the card (the host draws the tile).
 *
 * The adapter brings no plugin for devices: devices shows these components as its tiles. vis-2 shows the native
 * widgets of the same names and hides the components.
 */
import type {
    WebComponentManifest,
    WebComponentSetting,
    WebComponentSettingsPanel,
    WebComponentSettingsTabs,
} from '@iobroker/web-components';

import { ADAPTER_NAME } from '../lib/config';
import { FRAME_PREVIEW_LARGE, SCREENSAVER_PREVIEW_LARGE } from '../lib/previews';
import translations from '../translations';
import { FRAME_TAG, SCREENSAVER_TAG } from './constants';

const SCHEMA = 'https://raw.githubusercontent.com/ioBroker/web-components/main/schemas/manifest.json';

export const LANGUAGES: ioBroker.Languages[] = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

const DICTIONARIES = translations as unknown as Record<string, Record<string, string>>;

/**
 * A word of the set in every language
 *
 * @param key - the key in `src/i18n/*.json`
 */
export function tr(key: string): ioBroker.Translated {
    const result: Partial<Record<ioBroker.Languages, string>> = {};
    for (const lang of LANGUAGES) {
        const text = DICTIONARIES[lang]?.[key] ?? DICTIONARIES.en[key];
        if (text === undefined) {
            throw new Error(`No translation for "${key}"`);
        }
        result[lang] = text;
    }
    return result as ioBroker.Translated;
}

type Items = Record<string, WebComponentSetting>;

function select(
    label: string,
    def: string,
    options: [value: string, label: string][],
    extra?: Partial<WebComponentSetting>,
): WebComponentSetting {
    return {
        type: 'select',
        label: tr(label),
        default: def,
        options: options.map(([value, text]) => ({ value, label: tr(text) })),
        ...extra,
    };
}

function checkbox(label: string, def: boolean, extra?: Partial<WebComponentSetting>): WebComponentSetting {
    return { type: 'checkbox', label: tr(label), default: def, ...extra };
}

function stateId(label: string, extra?: Partial<WebComponentSetting>): WebComponentSetting {
    return { type: 'objectId', label: tr(label), types: 'state', ...extra };
}

function panel(label: string, items: Items): WebComponentSettingsPanel {
    return { type: 'panel', label: tr(label), items };
}

// `hidden` is evaluated over the values; a new instance has the defaults, an older one may miss a value
const NOT_FOLDER = "!!data.source && data.source !== 'folder'";
const CAPTION_OFF = "data.captionPosition === 'off'";
const NOT_ADAPTER = "data.source !== 'adapter'";
const NOT_FOLDER_OR_ADAPTER = "!!data.source && data.source !== 'folder' && data.source !== 'adapter'";

/**
 * Hidden unless the source is the album of the adapter with one of these date filters
 *
 * @param kinds - the date filters the setting belongs to
 */
function notFilter(...kinds: string[]): string {
    return `data.source !== 'adapter' || ![${kinds.map(kind => `'${kind}'`).join(', ')}].includes(data.dateFilter || 'all')`;
}

function sourcePanel(): WebComponentSettingsPanel {
    return panel('group_source', {
        source: select(
            'source',
            'folder',
            [
                ['folder', 'source_folder'],
                ['list', 'source_list'],
                ['state', 'source_state'],
                ['adapter', 'source_adapter'],
            ],
            { help: tr('source_tooltip') },
        ),
        instance: {
            type: 'instance',
            label: tr('instance'),
            help: tr('instance_tooltip'),
            adapter: ADAPTER_NAME,
            default: `${ADAPTER_NAME}.0`,
            hidden: NOT_ADAPTER,
        },
        album: {
            type: 'selectSendTo',
            label: tr('album'),
            help: tr('album_tooltip'),
            command: 'getAlbums',
             
            instance: '${data.instance}',
            hidden: NOT_ADAPTER,
        },
        dateFilter: select(
            'date_filter',
            'all',
            [
                ['all', 'filter_all'],
                ['lastDays', 'filter_last_days'],
                ['range', 'filter_range'],
                ['onThisDay', 'filter_on_this_day'],
            ],
            { help: tr('date_filter_tooltip'), hidden: NOT_ADAPTER },
        ),
        days: {
            type: 'number',
            label: tr('days'),
            help: tr('days_tooltip'),
            default: 30,
            min: 1,
            max: 36600,
            hidden: notFilter('lastDays'),
        },
        dateFrom: { type: 'text', label: tr('date_from'), help: tr('date_range_tooltip'), hidden: notFilter('range') },
        dateTo: { type: 'text', label: tr('date_to'), help: tr('date_range_tooltip'), hidden: notFilter('range') },
        yearsAgo: {
            type: 'number',
            label: tr('years_ago'),
            help: tr('years_ago_tooltip'),
            default: 1,
            min: 0,
            max: 100,
            hidden: notFilter('onThisDay'),
        },
        windowDays: {
            type: 'number',
            label: tr('window_days'),
            help: tr('window_days_tooltip'),
            default: 0,
            min: 0,
            max: 14,
            hidden: notFilter('onThisDay'),
        },
        filterFallback: checkbox('filter_fallback', true, {
            help: tr('filter_fallback_tooltip'),
            hidden: notFilter('lastDays', 'range', 'onThisDay'),
        }),
        folder: { type: 'text', label: tr('folder'), help: tr('wc_folder_tooltip'), hidden: NOT_FOLDER },
        recursive: checkbox('recursive', false, { hidden: NOT_FOLDER }),
        albumOid: stateId('album_oid', { help: tr('album_oid_tooltip'), hidden: NOT_FOLDER_OR_ADAPTER }),
        urls: { type: 'text', label: tr('urls'), help: tr('urls_tooltip'), minRows: 5, hidden: "data.source !== 'list'" },
        listOid: stateId('list_oid', { help: tr('list_oid_tooltip'), hidden: "data.source !== 'state'" }),
    });
}

function displayPanel(): WebComponentSettingsPanel {
    return panel('group_display', {
        interval: { type: 'number', label: tr('interval'), default: 10, min: 2, max: 3600 },
        order: select('order', 'sequential', [
            ['sequential', 'order_sequential'],
            ['random', 'order_random'],
        ]),
        transition: select('transition', 'fade', [
            ['none', 'transition_none'],
            ['fade', 'transition_fade'],
            ['slide', 'transition_slide'],
        ]),
        transitionTime: {
            type: 'number',
            label: tr('transition_time'),
            default: 1.5,
            min: 0.1,
            max: 10,
            step: 0.1,
            hidden: "data.transition === 'none'",
        },
        kenBurns: checkbox('ken_burns', true),
        fit: select(
            'fit',
            'cover',
            [
                ['cover', 'fit_cover'],
                ['contain', 'fit_contain'],
            ],
            { help: tr('fit_tooltip') },
        ),
        pairPortraits: checkbox('pair_portraits', true),
        dots: checkbox('dots', true),
    });
}

function captionPanel(): WebComponentSettingsPanel {
    return panel('group_caption', {
        captionPosition: select('caption_position', 'bottomLeft', [
            ['bottomLeft', 'pos_bottom_left'],
            ['bottomRight', 'pos_bottom_right'],
            ['off', 'pos_off'],
        ]),
        showDate: checkbox('show_date', true, { hidden: CAPTION_OFF }),
        placeSource: select(
            'place_source',
            'exif',
            [
                ['off', 'place_off'],
                ['exif', 'place_exif'],
                ['osm', 'place_osm'],
            ],
            { help: tr('place_source_tooltip'), hidden: CAPTION_OFF },
        ),
        showPhotoCaption: checkbox('show_photo_caption', true, { hidden: CAPTION_OFF }),
        captionText: { type: 'text', label: tr('caption_text'), help: tr('caption_text_tooltip'), hidden: CAPTION_OFF },
    });
}

/**
 * Clock and weather
 *
 * @param clockByDefault - the screensaver shows the clock unless switched off, the frame only if switched on
 */
function infoPanel(clockByDefault: boolean): WebComponentSettingsPanel {
    const noClock = clockByDefault ? 'data.showClock === false' : '!data.showClock';
    return panel('group_info', {
        showClock: checkbox('show_clock', clockByDefault),
        clockSeconds: checkbox('clock_seconds', false, { hidden: noClock }),
        clockDate: checkbox('clock_date', true, { hidden: noClock }),
        infoPosition: select('info_position', 'topRight', [
            ['topRight', 'pos_top_right'],
            ['topLeft', 'pos_top_left'],
            ['bottomRight', 'pos_bottom_right'],
            ['bottomLeft', 'pos_bottom_left'],
            ['center', 'pos_center'],
        ]),
        weatherDivider: { type: 'divider' },
        weatherTempOid: stateId('weather_temperature', { help: tr('weather_tooltip') }),
        weatherTextOid: stateId('weather_text', { help: tr('weather_text_tooltip') }),
        weatherIconOid: stateId('weather_icon', { help: tr('weather_icon_tooltip') }),
        weatherWindOid: stateId('weather_wind'),
        weatherHumidityOid: stateId('weather_humidity'),
        weatherPrecipOid: stateId('weather_precipitation'),
    });
}

function controlPanel(): WebComponentSettingsPanel {
    return panel('group_control', {
        interactive: checkbox('interactive', true, { help: tr('interactive_tooltip') }),
        nextOid: stateId('next_oid', { help: tr('button_oid_tooltip') }),
        prevOid: stateId('prev_oid', { help: tr('button_oid_tooltip') }),
        pauseOid: stateId('pause_oid', { help: tr('pause_oid_tooltip') }),
    });
}

function screensaverPanel(): WebComponentSettingsPanel {
    return panel('screensaver', {
        timeout: {
            type: 'number',
            label: tr('timeout'),
            help: tr('wc_timeout_tooltip'),
            default: 5,
            min: 0,
            max: 1440,
            step: 0.5,
        },
        endOnMouseMove: checkbox('end_on_mouse_move', true, { help: tr('end_on_mouse_move_tooltip') }),
        stateDivider: { type: 'divider' },
        enabledOid: stateId('enabled_oid', { help: tr('enabled_oid_tooltip') }),
        dimOid: stateId('dim_oid', { help: tr('dim_oid_tooltip') }),
        dimLevel: {
            type: 'slider',
            label: tr('dim_level'),
            help: tr('dim_level_tooltip'),
            default: 30,
            min: 0,
            max: 100,
            step: 5,
            hidden: '!data.dimOid',
        },
    });
}

function tabs(items: Record<string, WebComponentSettingsPanel>): WebComponentSettingsTabs {
    return { type: 'tabs', items };
}

/** The photo frame */
export function buildFrameManifest(): WebComponentManifest {
    return {
        $schema: SCHEMA,
        manifestVersion: 1,
        tag: FRAME_TAG,
        name: tr('photo_frame'),
        description: tr('help_photo_frame'),
        icon: `${FRAME_TAG}.svg`,
        module: `${FRAME_TAG}.js`,
        // about 16:10; devices makes a tile of two columns of it
        size: { width: 320, height: 200 },
        settings: tabs({
            source: sourcePanel(),
            display: displayPanel(),
            caption: captionPanel(),
            info: infoPanel(false),
            control: controlPanel(),
        }),
    };
}

/** The screensaver */
export function buildScreensaverManifest(): WebComponentManifest {
    return {
        $schema: SCHEMA,
        manifestVersion: 1,
        tag: SCREENSAVER_TAG,
        name: tr('screensaver'),
        description: tr('wc_screensaver_desc'),
        icon: `${SCREENSAVER_TAG}.svg`,
        module: `${SCREENSAVER_TAG}.js`,
        // a small tile: the screensaver itself lies over the whole page
        size: { width: 160, height: 160 },
        settings: tabs({
            screensaver: screensaverPanel(),
            source: sourcePanel(),
            display: displayPanel(),
            caption: captionPanel(),
            info: infoPanel(true),
        }),
    };
}

/** Both manifests */
export function buildManifests(): WebComponentManifest[] {
    return [buildFrameManifest(), buildScreensaverManifest()];
}

/**
 * An inline SVG of the palette as a file of its own
 *
 * @param svg - the SVG as `lib/previews.ts` has it
 */
function svgFile(svg: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')}\n`;
}

/** The icons the manifests name, by file name */
export function buildIcons(): Record<string, string> {
    return {
        [`${FRAME_TAG}.svg`]: svgFile(FRAME_PREVIEW_LARGE),
        [`${SCREENSAVER_TAG}.svg`]: svgFile(SCREENSAVER_PREVIEW_LARGE),
    };
}
