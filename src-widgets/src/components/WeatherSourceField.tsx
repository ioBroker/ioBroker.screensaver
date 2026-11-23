import React from 'react';

import { MenuItem, TextField } from '@mui/material';

import type {
    RxWidgetInfoAttributesField,
    RxWidgetInfoCustomComponentProperties,
    WidgetData,
} from '@iobroker/types-vis-2';

import { t } from '../lib/i18n';
import {
    NO_WEATHER,
    WEATHER_SLOTS,
    listWeatherSources,
    resolveWeatherSource,
    type FoundWeather,
    type ObjectView,
    type WeatherSlot,
    type WeatherSourceOption,
} from '../lib/weatherSource';

interface WeatherSourceProps {
    field: RxWidgetInfoAttributesField;
    data: WidgetData;
    onDataChange: (newData: WidgetData) => void;
    props: RxWidgetInfoCustomComponentProperties;
}

/** The label of each value of the card, as the fields of the object IDs below are called */
const SLOT_LABELS: Record<WeatherSlot, string> = {
    temperature: 'weather_temperature',
    text: 'weather_text',
    icon: 'weather_icon',
    wind: 'weather_wind',
    humidity: 'weather_humidity',
    precipitation: 'weather_precipitation',
};

/**
 * The weather source: a select of the channels with the current weather of all weather adapters, and below it
 * which values were found there. Where the objects cannot be listed, a text field for the ID of a channel.
 *
 * @param props - the field, the data of the widget and the context of the editor
 */
function WeatherSourceInput(props: WeatherSourceProps): React.JSX.Element {
    const name = props.field.name || 'weatherSource';
    const value = typeof props.data[name] === 'string' ? (props.data[name]).trim() : '';
    const socket = props.props.context.socket;
    // null: still asking; undefined: the objects cannot be listed
    const [sources, setSources] = React.useState<WeatherSourceOption[] | null | undefined>(null);
    const [found, setFound] = React.useState<{ source: string; found: FoundWeather }>({
        source: '',
        found: NO_WEATHER,
    });

    const view = React.useMemo<ObjectView | null>(
        () =>
            typeof socket?.getObjectViewSystem === 'function'
                ? (type, start, end) => socket.getObjectViewSystem(type, start, end)
                : null,
        [socket],
    );

    React.useEffect(() => {
        if (!view) {
            return undefined;
        }
        let alive = true;
        listWeatherSources(view).then(
            list => alive && setSources(list),
            () => alive && setSources(undefined),
        );
        return () => {
            alive = false;
        };
    }, [view]);

    React.useEffect(() => {
        if (!view || !value) {
            return undefined;
        }
        let alive = true;
        resolveWeatherSource(view, value).then(
            result => alive && setFound({ source: value, found: result }),
            () => alive && setFound({ source: value, found: NO_WEATHER }),
        );
        return () => {
            alive = false;
        };
    }, [view, value]);

    const set = (source: string): void => props.onDataChange({ ...props.data, [name]: source });

    let helper = '';
    if (value && found.source === value) {
        const slots = WEATHER_SLOTS.filter(slot => found.found.states[slot]);
        helper = slots.length
            ? t('weather_source_found', slots.map(slot => t(SLOT_LABELS[slot])).join(', '))
            : t('weather_source_nothing');
    }

    if (view && sources?.length) {
        const known = !value || sources.some(source => source.value === value);
        return (
            <TextField
                select
                variant="standard"
                size="small"
                fullWidth
                value={value}
                helperText={helper}
                onChange={e => set(e.target.value)}
                slotProps={{ select: { displayEmpty: true } }}
            >
                <MenuItem value="">{t('weather_source_none')}</MenuItem>
                {sources.map(source => (
                    <MenuItem
                        key={source.value}
                        value={source.value}
                    >
                        {source.label}
                    </MenuItem>
                ))}
                {known ? null : (
                    <MenuItem
                        key={value}
                        value={value}
                    >
                        {value}
                    </MenuItem>
                )}
            </TextField>
        );
    }

    if (!helper) {
        helper = sources === null && view ? t('weather_source_asking') : t('weather_source_no_adapter');
    }
    return (
        <TextField
            variant="standard"
            size="small"
            fullWidth
            value={value}
            placeholder="openweathermap.0.forecast.current"
            helperText={helper}
            onChange={e => set(e.target.value.trim())}
        />
    );
}

/**
 * The `component` of a `custom` attribute field
 *
 * @param field - the field
 * @param data - the data of the widget
 * @param onDataChange - writes the data of the widget
 * @param props - the context of the editor
 */
export function renderWeatherSourceField(
    field: RxWidgetInfoAttributesField,
    data: WidgetData,
    onDataChange: (newData: WidgetData) => void,
    props: RxWidgetInfoCustomComponentProperties,
): React.JSX.Element {
    return (
        <WeatherSourceInput
            field={field}
            data={data}
            onDataChange={onDataChange}
            props={props}
        />
    );
}
