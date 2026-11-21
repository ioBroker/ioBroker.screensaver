import React from 'react';

import type { FrameConfig, InfoPosition } from '../lib/config';
import { hasWeather } from '../lib/config';
import { useNow, type Size } from '../lib/hooks';
import { weatherIcon } from '../lib/weather';
import WeatherGlyph, { DetailIcon } from './WeatherGlyph';
import { TEXT_SHADOW } from './styles';

/**
 * A number as the language writes it: `-4,7` in German, `-4.7` in English
 *
 * @param value - the value of a state
 * @param lang - the language
 * @param decimals - the most decimals shown
 */
export function formatNumber(value: unknown, lang: string, decimals = 1): string | null {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value.replace(',', '.')) : NaN;
    if (!isFinite(num)) {
        return null;
    }
    return num.toLocaleString(lang, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function withUnit(value: string | null, unit: string): string | null {
    if (value === null) {
        return null;
    }
    return unit ? `${value} ${unit}` : value;
}

/** Where the panel sits, and to which side its lines are aligned */
function placement(position: InfoPosition, pad: number): React.CSSProperties {
    switch (position) {
        case 'topLeft':
            return { top: pad, left: pad, alignItems: 'flex-start', textAlign: 'left' };
        case 'bottomLeft':
            return { bottom: pad, left: pad, alignItems: 'flex-start', textAlign: 'left' };
        case 'bottomRight':
            return { bottom: pad, right: pad, alignItems: 'flex-end', textAlign: 'right' };
        case 'center':
            return {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                alignItems: 'center',
                textAlign: 'center',
            };
        default:
            return { top: pad, right: pad, alignItems: 'flex-end', textAlign: 'right' };
    }
}

/** A soft shadow from the corner of the panel, so that white writing stays readable on a bright sky */
function scrim(position: InfoPosition): string {
    const at =
        position === 'topLeft'
            ? '0% 0%'
            : position === 'bottomLeft'
              ? '0% 100%'
              : position === 'bottomRight'
                ? '100% 100%'
                : position === 'center'
                  ? '50% 50%'
                  : '100% 0%';
    return `radial-gradient(ellipse at ${at}, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0) 55%)`;
}

interface ClockProps {
    size: number;
    seconds: boolean;
    date: boolean;
    lang: string;
}

/** Only the clock renders every second, not the slideshow around it */
function Clock(props: ClockProps): React.JSX.Element {
    const now = useNow(props.seconds);
    const time = now.toLocaleTimeString(props.lang, {
        hour: '2-digit',
        minute: '2-digit',
        ...(props.seconds ? { second: '2-digit' } : {}),
    });
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'inherit' }}>
            <div
                style={{
                    fontSize: props.size,
                    lineHeight: 1,
                    fontWeight: 400,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                }}
            >
                {time}
            </div>
            {props.date ? (
                <div
                    style={{
                        fontSize: Math.max(10, props.size * 0.27),
                        marginTop: props.size * 0.12,
                        whiteSpace: 'nowrap',
                        opacity: 0.95,
                    }}
                >
                    {now.toLocaleDateString(props.lang, { weekday: 'short', day: 'numeric', month: 'long' })}
                </div>
            ) : null}
        </div>
    );
}

export interface WeatherValues {
    temperature?: unknown;
    text?: unknown;
    icon?: unknown;
    wind?: unknown;
    humidity?: unknown;
    precipitation?: unknown;
}

interface WeatherCardProps {
    values: WeatherValues;
    units: { temperature: string; wind: string; humidity: string; precipitation: string };
    /** The size of the clock, everything of the card follows from it */
    base: number;
    lang: string;
    details: boolean;
}

/** The weather in a card of frosted glass, under the clock */
function WeatherCard(props: WeatherCardProps): React.JSX.Element | null {
    const { values, units, base, lang } = props;
    const icon = weatherIcon(values.icon, values.text);
    const temperature = withUnit(formatNumber(values.temperature, lang, 1), units.temperature);
    const text = typeof values.text === 'string' ? values.text.trim() : '';
    const wind = withUnit(formatNumber(values.wind, lang, 0), units.wind);
    const humidity = withUnit(formatNumber(values.humidity, lang, 0), units.humidity);
    const precipitation = withUnit(formatNumber(values.precipitation, lang, 1), units.precipitation);

    if (!icon && temperature === null && !text) {
        return null;
    }

    const glyph = base * 0.68;
    const snowy = icon && 'kind' in icon && (icon.kind === 'snow' || icon.kind === 'sleet');
    const detailSize = Math.max(10, base * 0.16);
    const details = [
        wind ? { kind: 'wind' as const, text: wind } : null,
        humidity ? { kind: 'humidity' as const, text: humidity } : null,
        precipitation ? { kind: snowy ? ('snow' as const) : ('rain' as const), text: precipitation } : null,
    ].filter((item): item is { kind: 'wind' | 'humidity' | 'rain' | 'snow'; text: string } => !!item);

    return (
        <div
            style={{
                marginTop: base * 0.32,
                padding: `${base * 0.2}px ${base * 0.26}px`,
                borderRadius: base * 0.18,
                // no backdrop-filter: it makes a weak tablet redraw the photo under it in every frame of a transition
                background: 'rgba(30, 34, 48, 0.32)',
                border: '1px solid rgba(255, 255, 255, 0.38)',
                display: 'flex',
                flexDirection: 'column',
                gap: base * 0.16,
                textShadow: 'none',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: base * 0.24 }}>
                {icon && 'url' in icon ? (
                    <img
                        src={icon.url}
                        alt=""
                        style={{ width: glyph, height: glyph, objectFit: 'contain' }}
                    />
                ) : icon ? (
                    <WeatherGlyph
                        kind={icon.kind}
                        size={glyph}
                    />
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left' }}>
                    {temperature !== null ? (
                        <div
                            style={{
                                fontSize: base * 0.42,
                                fontWeight: 600,
                                lineHeight: 1.05,
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            {temperature}
                        </div>
                    ) : null}
                    {text ? (
                        <div
                            style={{
                                fontSize: Math.max(10, base * 0.17),
                                marginTop: base * 0.06,
                                opacity: 0.92,
                                maxWidth: base * 3,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {text}
                        </div>
                    ) : null}
                </div>
            </div>
            {props.details && details.length ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: base * 0.3, fontSize: detailSize }}>
                    {details.map(item => (
                        <div
                            key={item.kind}
                            style={{ display: 'flex', alignItems: 'center', gap: detailSize * 0.45, whiteSpace: 'nowrap' }}
                        >
                            <DetailIcon
                                kind={item.kind}
                                size={detailSize * 1.35}
                            />
                            {item.text}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export interface InfoPanelProps {
    config: FrameConfig;
    size: Size;
    lang: string;
    weather: WeatherValues;
    /** The units of the weather states, as their objects say */
    units: Record<string, string>;
    /** Below 1 the panel is dimmed with the screensaver, but stays readable */
    brightness?: number;
}

/**
 * The clock and the weather over the pictures, large on a whole page and small on a tile.
 *
 * @param props - what to show and how large the frame is
 */
export default function InfoPanel(props: InfoPanelProps): React.JSX.Element | null {
    const { config, size, lang } = props;
    const withWeather = hasWeather(config.weather) && size.height >= 160 && size.width >= 200;
    if ((!config.showClock && !withWeather) || size.width < 80 || size.height < 60) {
        return null;
    }
    // the clock is a sixth of the height, and not wider than the frame allows
    const base = Math.max(14, Math.min(size.height * 0.17, size.width * 0.13));
    const pad = Math.max(8, Math.min(size.width, size.height) * 0.05);
    const w = config.weather;
    const unit = (oid: string, def: string): string => (oid && props.units[oid]) || def;

    return (
        <>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    background: scrim(config.infoPosition),
                    opacity: props.brightness !== undefined ? Math.max(0.4, props.brightness) : 1,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    display: 'flex',
                    flexDirection: 'column',
                    color: '#fff',
                    textShadow: TEXT_SHADOW,
                    pointerEvents: 'none',
                    zIndex: 5,
                    opacity: props.brightness !== undefined ? Math.max(0.55, props.brightness) : 1,
                    ...placement(config.infoPosition, pad),
                }}
            >
                {config.showClock ? (
                    <Clock
                        size={base}
                        seconds={config.clockSeconds}
                        date={config.clockDate}
                        lang={lang}
                    />
                ) : null}
                {withWeather ? (
                    <WeatherCard
                        values={props.weather}
                        units={{
                            temperature: unit(w.temperature, '°C'),
                            wind: unit(w.wind, 'km/h'),
                            humidity: unit(w.humidity, '%'),
                            precipitation: unit(w.precipitation, 'mm'),
                        }}
                        base={config.showClock ? base : base * 1.1}
                        lang={lang}
                        details={size.width >= 320}
                    />
                ) : null}
            </div>
        </>
    );
}
