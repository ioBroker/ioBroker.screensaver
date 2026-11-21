/**
 * The attribute groups of the editor, shared by the photo frame and the screensaver.
 *
 * Both show the same slideshow, so they are set up with the same fields under the same names: a screensaver
 * can be set up like a frame, and `readFrameConfig` reads both. The screensaver passes `noBinding`, because its
 * settings are read by the background service, which sees the data as stored - a binding there would be text.
 */

import type { RxWidgetInfoAttributesField, RxWidgetInfoGroup, WidgetData } from '@iobroker/types-vis-2';

import { renderAlbumField } from '../components/AlbumField';
import { renderFolderField } from '../components/FolderField';
import { ADAPTER_NAME } from './config';

export interface GroupOptions {
    /** No bindings: the service reads the data as stored */
    noBinding?: boolean;
    /** The clock is on by default */
    clockByDefault?: boolean;
}

const isSource =
    (source: string) =>
    (data: WidgetData): boolean =>
        (data.source || 'folder') !== source;

/** A field of the date filter: only for an album of the adapter, and only for one kind of filter */
const notFilter =
    (...kinds: string[]) =>
    (data: WidgetData): boolean =>
        data.source !== 'adapter' || !kinds.includes(data.dateFilter || 'all');

function withBinding(fields: RxWidgetInfoAttributesField[], options: GroupOptions): RxWidgetInfoAttributesField[] {
    return options.noBinding ? fields.map(field => ({ ...field, noBinding: true })) : fields;
}

/** Where the pictures come from */
export function sourceGroup(options: GroupOptions = {}): RxWidgetInfoGroup {
    return {
        name: 'source',
        label: 'group_source',
        fields: withBinding(
            [
                {
                    name: 'source',
                    label: 'source',
                    tooltip: 'source_tooltip',
                    type: 'select',
                    default: 'folder',
                    options: [
                        { value: 'folder', label: 'source_folder' },
                        { value: 'list', label: 'source_list' },
                        { value: 'state', label: 'source_state' },
                        { value: 'adapter', label: 'source_adapter' },
                    ],
                },
                {
                    name: 'instance',
                    label: 'instance',
                    tooltip: 'instance_tooltip',
                    type: 'instance',
                    adapter: ADAPTER_NAME,
                    default: `${ADAPTER_NAME}.0`,
                    hidden: isSource('adapter'),
                },
                {
                    name: 'album',
                    label: 'album',
                    tooltip: 'album_tooltip',
                    type: 'custom',
                    component: (field, data, onDataChange, props) =>
                        renderAlbumField(field, data, onDataChange, props),
                    hidden: isSource('adapter'),
                },
                {
                    name: 'dateFilter',
                    label: 'date_filter',
                    tooltip: 'date_filter_tooltip',
                    type: 'select',
                    default: 'all',
                    options: [
                        { value: 'all', label: 'filter_all' },
                        { value: 'lastDays', label: 'filter_last_days' },
                        { value: 'range', label: 'filter_range' },
                        { value: 'onThisDay', label: 'filter_on_this_day' },
                    ],
                    hidden: isSource('adapter'),
                },
                {
                    name: 'days',
                    label: 'days',
                    tooltip: 'days_tooltip',
                    type: 'number',
                    default: 30,
                    min: 1,
                    max: 36600,
                    hidden: notFilter('lastDays'),
                },
                {
                    name: 'dateFrom',
                    label: 'date_from',
                    tooltip: 'date_range_tooltip',
                    type: 'text',
                    hidden: notFilter('range'),
                },
                {
                    name: 'dateTo',
                    label: 'date_to',
                    tooltip: 'date_range_tooltip',
                    type: 'text',
                    hidden: notFilter('range'),
                },
                {
                    name: 'yearsAgo',
                    label: 'years_ago',
                    tooltip: 'years_ago_tooltip',
                    type: 'number',
                    default: 1,
                    min: 0,
                    max: 100,
                    hidden: notFilter('onThisDay'),
                },
                {
                    name: 'windowDays',
                    label: 'window_days',
                    tooltip: 'window_days_tooltip',
                    type: 'number',
                    default: 0,
                    min: 0,
                    max: 14,
                    hidden: notFilter('onThisDay'),
                },
                {
                    name: 'filterFallback',
                    label: 'filter_fallback',
                    tooltip: 'filter_fallback_tooltip',
                    type: 'checkbox',
                    default: true,
                    hidden: notFilter('lastDays', 'range', 'onThisDay'),
                },
                {
                    name: 'folder',
                    label: 'folder',
                    tooltip: 'folder_tooltip',
                    type: 'custom',
                    component: renderFolderField,
                    hidden: isSource('folder'),
                },
                {
                    name: 'recursive',
                    label: 'recursive',
                    tooltip: 'recursive_tooltip',
                    type: 'checkbox',
                    hidden: isSource('folder'),
                },
                {
                    name: 'albumOid',
                    label: 'album_oid',
                    tooltip: 'album_oid_tooltip',
                    type: 'id',
                    noInit: true,
                    hidden: (data: WidgetData): boolean => !['folder', 'adapter'].includes(data.source || 'folder'),
                },
                {
                    name: 'urls',
                    label: 'urls',
                    tooltip: 'urls_tooltip',
                    type: 'html',
                    multiline: true,
                    hidden: isSource('list'),
                },
                {
                    name: 'listOid',
                    label: 'list_oid',
                    tooltip: 'list_oid_tooltip',
                    type: 'id',
                    noInit: true,
                    hidden: isSource('state'),
                },
            ],
            options,
        ),
    };
}

/** How the pictures are shown */
export function displayGroup(options: GroupOptions = {}): RxWidgetInfoGroup {
    return {
        name: 'display',
        label: 'group_display',
        fields: withBinding(
            [
                {
                    name: 'interval',
                    label: 'interval',
                    tooltip: 'interval_tooltip',
                    type: 'number',
                    default: 10,
                    min: 2,
                    max: 3600,
                },
                {
                    name: 'order',
                    label: 'order',
                    tooltip: 'order_tooltip',
                    type: 'select',
                    default: 'sequential',
                    options: [
                        { value: 'sequential', label: 'order_sequential' },
                        { value: 'random', label: 'order_random' },
                    ],
                },
                {
                    name: 'transition',
                    label: 'transition',
                    tooltip: 'transition_tooltip',
                    type: 'select',
                    default: 'fade',
                    options: [
                        { value: 'none', label: 'transition_none' },
                        { value: 'fade', label: 'transition_fade' },
                        { value: 'slide', label: 'transition_slide' },
                    ],
                },
                {
                    name: 'transitionTime',
                    label: 'transition_time',
                    tooltip: 'transition_time_tooltip',
                    type: 'number',
                    default: 1.5,
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    hidden: (data: WidgetData) => data.transition === 'none',
                },
                {
                    name: 'kenBurns',
                    label: 'ken_burns',
                    tooltip: 'ken_burns_tooltip',
                    type: 'checkbox',
                    default: true,
                },
                {
                    name: 'fit',
                    label: 'fit',
                    tooltip: 'fit_tooltip',
                    type: 'select',
                    default: 'cover',
                    options: [
                        { value: 'cover', label: 'fit_cover' },
                        { value: 'contain', label: 'fit_contain' },
                    ],
                },
                {
                    name: 'pairPortraits',
                    label: 'pair_portraits',
                    tooltip: 'pair_portraits_tooltip',
                    type: 'checkbox',
                    default: true,
                },
                {
                    name: 'dots',
                    label: 'dots',
                    tooltip: 'dots_tooltip',
                    type: 'checkbox',
                    default: true,
                },
            ],
            options,
        ),
    };
}

/** The caption under each picture */
export function captionGroup(options: GroupOptions = {}): RxWidgetInfoGroup {
    const off = (data: WidgetData): boolean => data.captionPosition === 'off';
    return {
        name: 'caption',
        label: 'group_caption',
        fields: withBinding(
            [
                {
                    name: 'captionPosition',
                    label: 'caption_position',
                    tooltip: 'caption_position_tooltip',
                    type: 'select',
                    default: 'bottomLeft',
                    options: [
                        { value: 'bottomLeft', label: 'pos_bottom_left' },
                        { value: 'bottomRight', label: 'pos_bottom_right' },
                        { value: 'off', label: 'pos_off' },
                    ],
                },
                {
                    name: 'showDate',
                    label: 'show_date',
                    tooltip: 'show_date_tooltip',
                    type: 'checkbox',
                    default: true,
                    hidden: off,
                },
                {
                    name: 'placeSource',
                    label: 'place_source',
                    tooltip: 'place_source_tooltip',
                    type: 'select',
                    default: 'exif',
                    options: [
                        { value: 'off', label: 'place_off' },
                        { value: 'exif', label: 'place_exif' },
                        { value: 'osm', label: 'place_osm' },
                    ],
                    hidden: off,
                },
                {
                    name: 'showPhotoCaption',
                    label: 'show_photo_caption',
                    tooltip: 'show_photo_caption_tooltip',
                    type: 'checkbox',
                    default: true,
                    hidden: off,
                },
                {
                    name: 'captionText',
                    label: 'caption_text',
                    tooltip: 'caption_text_tooltip',
                    type: 'text',
                    hidden: off,
                },
            ],
            options,
        ),
    };
}

/** Clock and weather over the pictures */
export function infoGroup(options: GroupOptions = {}): RxWidgetInfoGroup {
    const noClock = (data: WidgetData): boolean =>
        data.showClock === false || data.showClock === 'false' || (!options.clockByDefault && !data.showClock);
    return {
        name: 'info',
        label: 'group_info',
        fields: withBinding(
            [
                {
                    name: 'showClock',
                    label: 'show_clock',
                    tooltip: 'show_clock_tooltip',
                    type: 'checkbox',
                    default: !!options.clockByDefault,
                },
                {
                    name: 'clockSeconds',
                    label: 'clock_seconds',
                    type: 'checkbox',
                    hidden: noClock,
                },
                {
                    name: 'clockDate',
                    label: 'clock_date',
                    type: 'checkbox',
                    default: true,
                    hidden: noClock,
                },
                {
                    name: 'infoPosition',
                    label: 'info_position',
                    tooltip: 'info_position_tooltip',
                    type: 'select',
                    default: 'topRight',
                    options: [
                        { value: 'topRight', label: 'pos_top_right' },
                        { value: 'topLeft', label: 'pos_top_left' },
                        { value: 'bottomRight', label: 'pos_bottom_right' },
                        { value: 'bottomLeft', label: 'pos_bottom_left' },
                        { value: 'center', label: 'pos_center' },
                    ],
                },
                { name: 'weatherDelimiter', type: 'delimiter' },
                {
                    name: 'weatherTempOid',
                    label: 'weather_temperature',
                    tooltip: 'weather_tooltip',
                    type: 'id',
                    noInit: true,
                },
                {
                    name: 'weatherTextOid',
                    label: 'weather_text',
                    tooltip: 'weather_text_tooltip',
                    type: 'id',
                    noInit: true,
                },
                {
                    name: 'weatherIconOid',
                    label: 'weather_icon',
                    tooltip: 'weather_icon_tooltip',
                    type: 'id',
                    noInit: true,
                },
                {
                    name: 'weatherWindOid',
                    label: 'weather_wind',
                    type: 'id',
                    noInit: true,
                },
                {
                    name: 'weatherHumidityOid',
                    label: 'weather_humidity',
                    type: 'id',
                    noInit: true,
                },
                {
                    name: 'weatherPrecipOid',
                    label: 'weather_precipitation',
                    type: 'id',
                    noInit: true,
                },
            ],
            options,
        ),
    };
}
