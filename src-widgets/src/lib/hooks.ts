import React from 'react';

import type { Connection } from '@iobroker/gui-components';

import { NO_WEATHER, resolveWeatherSource, type FoundWeather, type ObjectMap } from './weatherSource';

/** The size of an element, kept up to date */
export interface Size {
    width: number;
    height: number;
}

/**
 * The size of the element behind the ref, from a ResizeObserver.
 *
 * A widget in a cell of the grid, a frame on a page that is turned, the editor resizing it: the size has to be
 * known all the time, because it decides how large the pictures are loaded and how large the clock is drawn.
 *
 * @param ref - the element
 */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): Size | null {
    const [size, setSize] = React.useState<Size | null>(null);

    React.useEffect(() => {
        const element = ref.current;
        if (!element) {
            return undefined;
        }
        const update = (width: number, height: number): void => {
            const w = Math.round(width);
            const h = Math.round(height);
            setSize(old => (old && old.width === w && old.height === h ? old : { width: w, height: h }));
        };
        update(element.clientWidth, element.clientHeight);
        if (typeof ResizeObserver === 'undefined') {
            const onResize = (): void => update(element.clientWidth, element.clientHeight);
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }
        const observer = new ResizeObserver(entries => {
            const rect = entries[0]?.contentRect;
            if (rect) {
                update(rect.width, rect.height);
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return size;
}

/**
 * A ref that always holds the latest value, for callbacks that run outside of React (timers, listeners of the
 * window, the slide engine). Written after the render, as React wants it.
 *
 * @param value - the value of this render
 */
export function useLatest<T>(value: T): React.RefObject<T> {
    const ref = React.useRef(value);
    React.useLayoutEffect(() => {
        ref.current = value;
    });
    return ref;
}

/**
 * The values of states, subscribed while the component lives.
 *
 * The widgets get their values from vis-2, which subscribes the object IDs of their attributes. The background
 * service of the screensaver is no widget, so it subscribes them itself.
 *
 * @param socket - the connection
 * @param oids - the object IDs; empty ones are left out
 */
export function useStateValues(
    socket: Connection | null | undefined,
    oids: string[],
): Record<string, ioBroker.StateValue | undefined> {
    // the value of a state that is no longer subscribed is never asked for: not worth a render to remove it
    const [values, setValues] = React.useState<Record<string, ioBroker.StateValue | undefined>>({});
    const key = [...new Set(oids.filter(Boolean))].sort().join('\n');

    React.useEffect(() => {
        const list = key ? key.split('\n') : [];
        if (!socket || !list.length) {
            return undefined;
        }
        const handler = (id: string, state: ioBroker.State | null | undefined): void => {
            if (list.includes(id)) {
                setValues(old => (old[id] === state?.val ? old : { ...old, [id]: state?.val }));
            }
        };
        void socket.subscribeState(list, handler);
        return () => socket.unsubscribeState(list, handler);
    }, [socket, key]);

    return values;
}

/**
 * The unit of each state, read once from its object
 *
 * @param socket - the connection
 * @param oids - the object IDs
 */
export function useUnits(socket: Connection | null | undefined, oids: string[]): Record<string, string> {
    const [units, setUnits] = React.useState<Record<string, string>>({});
    const key = [...new Set(oids.filter(Boolean))].sort().join('\n');

    React.useEffect(() => {
        const list = key ? key.split('\n') : [];
        if (!socket || !list.length) {
            return undefined;
        }
        let alive = true;
        void Promise.all(
            list.map(oid =>
                socket
                    .getObject(oid)
                    .then(obj => [oid, ((obj?.common as ioBroker.StateCommon | undefined)?.unit || '').trim()] as const)
                    .catch(() => [oid, ''] as const),
            ),
        ).then(entries => {
            if (alive) {
                setUnits(Object.fromEntries(entries));
            }
        });
        return () => {
            alive = false;
        };
    }, [socket, key]);

    return units;
}

/**
 * The current time, ticking once a second where seconds are shown and once every few seconds otherwise.
 *
 * @param withSeconds - the seconds are shown
 */
export function useNow(withSeconds: boolean): Date {
    const [now, setNow] = React.useState(() => new Date());

    React.useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const tick = (): void => {
            const date = new Date();
            setNow(date);
            // on the change of the second or of the minute, not some time after it
            const wait = withSeconds
                ? 1000 - date.getMilliseconds()
                : 60000 - date.getSeconds() * 1000 - date.getMilliseconds();
            timer = setTimeout(tick, Math.max(50, Math.min(wait, 10000)));
        };
        tick();
        return () => clearTimeout(timer);
    }, [withSeconds]);

    return now;
}

/**
 * The states of the weather card in a channel of a weather adapter, read once per source
 *
 * @param socket - the connection; one without `getObjectViewSystem` finds nothing
 * @param source - the channel, like `openweathermap.0.forecast.current`; empty for none
 */
export function useWeatherSource(socket: Connection | null | undefined, source: string): FoundWeather {
    const [result, setResult] = React.useState<{ source: string; found: FoundWeather }>({
        source: '',
        found: NO_WEATHER,
    });

    React.useEffect(() => {
        if (!socket || !source || typeof socket.getObjectViewSystem !== 'function') {
            return undefined;
        }
        let alive = true;
        const view = (type: 'instance' | 'state', start: string, end: string): Promise<ObjectMap> =>
            socket.getObjectViewSystem(type, start, end);
        resolveWeatherSource(view, source).then(
            found => alive && setResult({ source, found }),
            () => alive && setResult({ source, found: NO_WEATHER }),
        );
        return () => {
            alive = false;
        };
    }, [socket, source]);

    return result.source === source ? result.found : NO_WEATHER;
}
