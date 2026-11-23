import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
    findWeatherSources,
    listWeatherSources,
    mergeWeather,
    pickWeatherStates,
    resolveWeatherSource,
    type ObjectMap,
    type ObjectView,
} from './weatherSource';

function state(role: string, type = 'number', unit?: string): ObjectMap[string] {
    return { type: 'state', common: { role, type, ...(unit ? { unit } : {}) } };
}

/** The states open-meteo-weather 3.4 makes for a place, with a forecast per day and per hour */
const OPEN_METEO: ObjectMap = {
    'open-meteo-weather.0.Boat.weather.current.apparent_temperature': state(
        'value.temperature.feelslike',
        'number',
        '°C',
    ),
    'open-meteo-weather.0.Boat.weather.current.dew_point_2m': state('value.temperature.dewpoint', 'number', '°C'),
    'open-meteo-weather.0.Boat.weather.current.icon_url': state('weather.icon', 'string'),
    'open-meteo-weather.0.Boat.weather.current.precipitation': state('value.precipitation', 'number', 'mm'),
    'open-meteo-weather.0.Boat.weather.current.relative_humidity_2m': state('value.humidity', 'number', '%'),
    'open-meteo-weather.0.Boat.weather.current.showers': state('value.precipitation', 'number', 'mm'),
    'open-meteo-weather.0.Boat.weather.current.temperature_2m': state('value.temperature', 'number', '°C'),
    'open-meteo-weather.0.Boat.weather.current.weather_code': state('weather.state'),
    'open-meteo-weather.0.Boat.weather.current.weather_text': state('text', 'string'),
    'open-meteo-weather.0.Boat.weather.current.wind_direction_text': state('text', 'string'),
    'open-meteo-weather.0.Boat.weather.current.wind_gusts_10m': state('value.speed.wind.gust', 'number', 'km/h'),
    'open-meteo-weather.0.Boat.weather.current.wind_speed_10m': state('value.speed.wind', 'number', 'km/h'),
    'open-meteo-weather.0.Boat.weather.forecast.day0.temperature_2m_max': state(
        'value.temperature.max',
        'number',
        '°C',
    ),
    'open-meteo-weather.0.Boat.weather.forecast.day0.weather_text': state('text', 'string'),
    'open-meteo-weather.0.Boat.weather.forecast.hourly.next_hours.hour0.temperature_2m': state('value.temperature'),
    'open-meteo-weather.0.Boat.weather.forecast.hourly.next_hours.hour1.temperature_2m': state('value.temperature'),
};

/** The states of openweathermap: the current weather and a forecast per day */
const OPENWEATHERMAP: ObjectMap = {
    'openweathermap.0.forecast.current.humidity': state('value.humidity', 'number', '%'),
    'openweathermap.0.forecast.current.icon': state('weather.icon', 'string'),
    'openweathermap.0.forecast.current.precipitation': state('weather.precipitation', 'number', 'mm'),
    'openweathermap.0.forecast.current.state': state('weather.state', 'string'),
    'openweathermap.0.forecast.current.temperature': state('value.temperature', 'number', '°C'),
    'openweathermap.0.forecast.current.temperatureFeel': state('value.temperature.feel', 'number', '°C'),
    'openweathermap.0.forecast.current.title': state('weather.title', 'string'),
    'openweathermap.0.forecast.current.windSpeed': state('value.speed.wind', 'number', 'm/s'),
    'openweathermap.0.forecast.day0.state': state('weather.state', 'string'),
    'openweathermap.0.forecast.day0.temperatureMax': state('value.temperature.max', 'number', '°C'),
};

const INSTANCES: ObjectMap = {
    'system.adapter.admin.0': { type: 'instance', common: { type: 'general' } },
    'system.adapter.open-meteo-weather.0': { type: 'instance', common: { type: 'weather' } },
    'system.adapter.openweathermap.0': { type: 'instance', common: { type: 'weather' } },
    'system.adapter.hue.0': { type: 'instance', common: { type: 'lighting' } },
};

/** A view over objects, as the connection or the adapter reads them */
function viewOf(objects: ObjectMap, asked: string[] = []): ObjectView {
    return (type, start, end) => {
        asked.push(`${type} ${start}`);
        const result: ObjectMap = {};
        for (const [id, obj] of Object.entries(objects)) {
            if (id >= start && id <= end && (type === 'instance' ? obj?.type === 'instance' : obj?.type === 'state')) {
                result[id] = obj;
            }
        }
        return Promise.resolve(result);
    };
}

describe('the weather of a weather adapter', () => {
    it('finds the states of open-meteo by their roles', () => {
        assert.deepEqual(pickWeatherStates('open-meteo-weather.0.Boat.weather.current', OPEN_METEO), {
            temperature: 'open-meteo-weather.0.Boat.weather.current.temperature_2m',
            // the role is only `text`: the name says it
            text: 'open-meteo-weather.0.Boat.weather.current.weather_text',
            // the WMO code, for which the card draws its own symbol
            icon: 'open-meteo-weather.0.Boat.weather.current.weather_code',
            wind: 'open-meteo-weather.0.Boat.weather.current.wind_speed_10m',
            humidity: 'open-meteo-weather.0.Boat.weather.current.relative_humidity_2m',
            // not `showers`, which has the same role
            precipitation: 'open-meteo-weather.0.Boat.weather.current.precipitation',
        });
    });

    it('finds the states of openweathermap by their roles', () => {
        assert.deepEqual(pickWeatherStates('openweathermap.0.forecast.current', OPENWEATHERMAP), {
            temperature: 'openweathermap.0.forecast.current.temperature',
            text: 'openweathermap.0.forecast.current.state',
            icon: 'openweathermap.0.forecast.current.icon',
            wind: 'openweathermap.0.forecast.current.windSpeed',
            humidity: 'openweathermap.0.forecast.current.humidity',
            precipitation: 'openweathermap.0.forecast.current.precipitation',
        });
    });

    it('takes the current weather and not a forecast when the source is the whole instance', () => {
        const found = pickWeatherStates('open-meteo-weather.0', OPEN_METEO);
        assert.equal(found.temperature, 'open-meteo-weather.0.Boat.weather.current.temperature_2m');
        assert.equal(found.text, 'open-meteo-weather.0.Boat.weather.current.weather_text');
        assert.equal(
            pickWeatherStates('openweathermap.0', OPENWEATHERMAP).text,
            'openweathermap.0.forecast.current.state',
        );
    });

    it('lets the object IDs of the settings win over the states found', () => {
        const found = pickWeatherStates('openweathermap.0.forecast.current', OPENWEATHERMAP);
        const own = {
            temperature: 'alias.0.Outside.ACTUAL',
            text: '',
            icon: '',
            wind: '',
            humidity: '',
            precipitation: '',
        };
        const merged = mergeWeather(own, found);
        assert.equal(merged.temperature, 'alias.0.Outside.ACTUAL');
        assert.equal(merged.wind, 'openweathermap.0.forecast.current.windSpeed');
        assert.deepEqual(mergeWeather(own, {}), own);
    });

    it('offers the current weather of each place as a source, not the forecast per hour', () => {
        const twoPlaces: ObjectMap = {
            ...OPEN_METEO,
            'open-meteo-weather.0.Home.weather.current.temperature_2m': state('value.temperature'),
        };
        assert.deepEqual(findWeatherSources('open-meteo-weather.0', twoPlaces), [
            { value: 'open-meteo-weather.0.Boat.weather.current', label: 'open-meteo-weather.0 · Boat' },
            { value: 'open-meteo-weather.0.Home.weather.current', label: 'open-meteo-weather.0 · Home' },
        ]);
        assert.deepEqual(findWeatherSources('openweathermap.0', OPENWEATHERMAP), [
            { value: 'openweathermap.0.forecast.current', label: 'openweathermap.0' },
        ]);
    });

    it('offers the highest channels with a temperature of an adapter without a current weather', () => {
        const other: ObjectMap = {
            'daswetter.0.NextDays.Location_1.Day_1.Temperature': state('value.temperature'),
            'daswetter.0.NextDays.Location_1.Day_1.Hour_1.Temperature': state('value.temperature'),
        };
        assert.deepEqual(findWeatherSources('daswetter.0', other), [
            { value: 'daswetter.0.NextDays.Location_1.Day_1', label: 'daswetter.0 · NextDays / Location_1 / Day_1' },
        ]);
        assert.deepEqual(findWeatherSources('daswetter.0', {}), []);
    });

    it('lists the sources of the weather adapters only', async () => {
        const asked: string[] = [];
        const sources = await listWeatherSources(viewOf({ ...INSTANCES, ...OPEN_METEO, ...OPENWEATHERMAP }, asked));
        assert.deepEqual(
            sources.map(source => source.value),
            ['open-meteo-weather.0.Boat.weather.current', 'openweathermap.0.forecast.current'],
        );
        // the states of other adapters are never read
        assert.deepEqual(asked, ['instance system.adapter.', 'state open-meteo-weather.0.', 'state openweathermap.0.']);
    });

    it('reads the states and their units of a source, also of a state picked by hand', async () => {
        const view = viewOf(OPENWEATHERMAP);
        const found = await resolveWeatherSource(view, 'openweathermap.0.forecast.current');
        assert.equal(found.states.temperature, 'openweathermap.0.forecast.current.temperature');
        assert.deepEqual(found.units, {
            'openweathermap.0.forecast.current.temperature': '°C',
            'openweathermap.0.forecast.current.windSpeed': 'm/s',
            'openweathermap.0.forecast.current.humidity': '%',
            'openweathermap.0.forecast.current.precipitation': 'mm',
        });
        // a temperature picked by hand stands for its channel
        const byState = await resolveWeatherSource(view, 'openweathermap.0.forecast.current.temperature');
        assert.deepEqual(byState.states, found.states);
        assert.deepEqual(await resolveWeatherSource(view, ''), { states: {}, units: {} });
    });
});
