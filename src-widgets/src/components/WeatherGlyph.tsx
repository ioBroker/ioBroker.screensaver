import React from 'react';

import type { WeatherKind } from '../lib/weather';

/*
 * Weather symbols drawn here instead of taken from an icon set: in colour, like the ones on a phone, and the
 * size of a few hundred bytes. All of them on a box of 64 by 64.
 */

const CLOUD_PATH =
    'M20 50h26a10 10 0 0 0 1.2-19.93A14 14 0 0 0 20.4 28.2 11 11 0 0 0 20 50z';

function Sun(props: { cx: number; cy: number; r: number; id: string }): React.JSX.Element {
    const rays = [];
    for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const inner = props.r + props.r * 0.35;
        const outer = props.r + props.r * 0.75;
        rays.push(
            <line
                key={i}
                x1={props.cx + Math.cos(angle) * inner}
                y1={props.cy + Math.sin(angle) * inner}
                x2={props.cx + Math.cos(angle) * outer}
                y2={props.cy + Math.sin(angle) * outer}
                stroke="#FFC107"
                strokeWidth={props.r * 0.28}
                strokeLinecap="round"
            />,
        );
    }
    return (
        <g>
            <defs>
                <radialGradient
                    id={props.id}
                    cx="40%"
                    cy="35%"
                    r="70%"
                >
                    <stop
                        offset="0%"
                        stopColor="#FFE082"
                    />
                    <stop
                        offset="100%"
                        stopColor="#FF8F00"
                    />
                </radialGradient>
            </defs>
            {rays}
            <circle
                cx={props.cx}
                cy={props.cy}
                r={props.r}
                fill={`url(#${props.id})`}
            />
        </g>
    );
}

function Cloud(props: { dark?: boolean; dx?: number; dy?: number; scale?: number; id: string }): React.JSX.Element {
    const { dx = 0, dy = 0, scale = 1 } = props;
    return (
        <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
            <defs>
                <linearGradient
                    id={props.id}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                >
                    <stop
                        offset="0%"
                        stopColor={props.dark ? '#B0BEC5' : '#FFFFFF'}
                    />
                    <stop
                        offset="100%"
                        stopColor={props.dark ? '#78909C' : '#CFD8DC'}
                    />
                </linearGradient>
            </defs>
            <path
                d={CLOUD_PATH}
                fill={`url(#${props.id})`}
            />
        </g>
    );
}

function Drops(props: { color: string; count: number; short?: boolean }): React.JSX.Element {
    const lines = [];
    for (let i = 0; i < props.count; i++) {
        const x = 24 + i * 9;
        lines.push(
            <line
                key={i}
                x1={x}
                y1={53}
                x2={x - 3}
                y2={props.short ? 58 : 61}
                stroke={props.color}
                strokeWidth={3}
                strokeLinecap="round"
            />,
        );
    }
    return <g>{lines}</g>;
}

function Flakes(props: { positions: number[] }): React.JSX.Element {
    return (
        <g
            stroke="#E3F2FD"
            strokeWidth={2}
            strokeLinecap="round"
        >
            {props.positions.map(x => (
                <g
                    key={x}
                    transform={`translate(${x} 57)`}
                >
                    <line
                        x1={-4}
                        y1={0}
                        x2={4}
                        y2={0}
                    />
                    <line
                        x1={-2}
                        y1={-3.5}
                        x2={2}
                        y2={3.5}
                    />
                    <line
                        x1={2}
                        y1={-3.5}
                        x2={-2}
                        y2={3.5}
                    />
                </g>
            ))}
        </g>
    );
}

let ids = 0;

/**
 * A weather symbol in colour
 *
 * @param props - the kind of weather and the size
 * @param props.kind - which symbol
 * @param props.size - width and height in px
 */
export default function WeatherGlyph(props: { kind: WeatherKind; size: number }): React.JSX.Element {
    // gradients need ids that are unique in the page, and several frames may draw the same symbol
    const [id] = React.useState(() => `vis2ss-w${++ids}`);
    const { kind } = props;

    let content: React.ReactNode;
    switch (kind) {
        case 'clear':
            content = (
                <Sun
                    cx={32}
                    cy={32}
                    r={13}
                    id={`${id}s`}
                />
            );
            break;
        case 'partly':
            content = (
                <>
                    <Sun
                        cx={38}
                        cy={22}
                        r={10}
                        id={`${id}s`}
                    />
                    <Cloud
                        id={`${id}c`}
                        dx={-2}
                        dy={2}
                    />
                </>
            );
            break;
        case 'cloudy':
            content = (
                <>
                    <Cloud
                        id={`${id}b`}
                        dark
                        dx={10}
                        dy={-8}
                        scale={0.8}
                    />
                    <Cloud
                        id={`${id}c`}
                        dy={2}
                    />
                </>
            );
            break;
        case 'fog':
            content = (
                <>
                    <Cloud
                        id={`${id}c`}
                        dark
                        dy={-6}
                    />
                    <g
                        stroke="#CFD8DC"
                        strokeWidth={3}
                        strokeLinecap="round"
                    >
                        <line
                            x1={14}
                            y1={50}
                            x2={50}
                            y2={50}
                        />
                        <line
                            x1={18}
                            y1={57}
                            x2={46}
                            y2={57}
                        />
                    </g>
                </>
            );
            break;
        case 'drizzle':
        case 'rain':
            content = (
                <>
                    <Cloud
                        id={`${id}c`}
                        dark={kind === 'rain'}
                        dy={-6}
                    />
                    <Drops
                        color="#4FC3F7"
                        count={3}
                        short={kind === 'drizzle'}
                    />
                </>
            );
            break;
        case 'snow':
            content = (
                <>
                    <Cloud
                        id={`${id}c`}
                        dy={-6}
                    />
                    <Flakes positions={[22, 32, 42]} />
                </>
            );
            break;
        case 'sleet':
            content = (
                <>
                    <Cloud
                        id={`${id}c`}
                        dark
                        dy={-6}
                    />
                    <Drops
                        color="#4FC3F7"
                        count={1}
                    />
                    <Flakes positions={[36, 46]} />
                </>
            );
            break;
        case 'thunder':
            content = (
                <>
                    <Cloud
                        id={`${id}c`}
                        dark
                        dy={-6}
                    />
                    <path
                        d="M33 40l-7 12h6l-3 10 10-14h-6l4-8z"
                        fill="#FFCA28"
                    />
                </>
            );
            break;
        default:
            content = null;
    }

    return (
        <svg
            viewBox="0 0 64 64"
            width={props.size}
            height={props.size}
            style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25))' }}
            aria-hidden="true"
        >
            {content}
        </svg>
    );
}

/** Small line symbols for the details row of the weather card, drawn in the colour of the text */
export function DetailIcon(props: { kind: 'wind' | 'humidity' | 'rain' | 'snow'; size: number }): React.JSX.Element {
    let content: React.ReactNode;
    switch (props.kind) {
        case 'wind':
            content = (
                <path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
            );
            break;
        case 'humidity':
            content = <path d="M12 3.5c3.5 4.2 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.5-6.3 6-10.5z" />;
            break;
        case 'rain':
            content = (
                <>
                    <path d="M4 11a8 8 0 0 1 16 0z" />
                    <path d="M12 11v7a2 2 0 0 1-4 0" />
                </>
            );
            break;
        default:
            content = (
                <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5" />
            );
    }
    return (
        <svg
            viewBox="0 0 24 24"
            width={props.size}
            height={props.size}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ display: 'block', flexShrink: 0 }}
            aria-hidden="true"
        >
            {content}
        </svg>
    );
}
