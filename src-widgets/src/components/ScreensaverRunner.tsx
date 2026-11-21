import React from 'react';
import { createPortal } from 'react-dom';

import type { Connection } from '@iobroker/gui-components';

import { frameOids } from '../lib/config';
import { useLatest, useStateValues, useUnits } from '../lib/hooks';
import { brightnessOf, delayOf, isEnabled, pickCandidate, type ScreensaverCandidate } from '../lib/screensaver';
import type { ProjectLocation } from '../lib/useImageList';
import SlideShow from './SlideShow';

/**
 * - `idle`: nothing on the screen, the time without input runs
 * - `arming`: a few seconds before the start the slideshow is put into the page, invisible, so that the first
 *   picture is loaded when it fades in - and not a black screen for a second
 * - `shown`: on the screen
 * - `closing`: fading out, and still catching the touch that ended it
 */
type Phase = 'idle' | 'arming' | 'shown' | 'closing';

/** How long before the start the first picture is loaded */
const ARM_MS = 8000;

const FADE_IN_MS = 1200;
const FADE_OUT_MS = 400;

/**
 * After the touch that ended the screensaver, clicks are swallowed this long: a tablet sends the click of a tap
 * some time after the finger left, and that click must not switch the lamp under the screensaver.
 */
const SWALLOW_CLICKS_MS = 450;

/** Moving the mouse this far ends the screensaver; a mouse that only trembles does not */
const MOUSE_MOVE_PX = 24;

/** Where the screensaver of a widget stopped, to go on from there next time */
const resumeKeys = new Map<string, string>();

export interface ScreensaverRunnerProps {
    socket: Connection;
    project: ProjectLocation;
    /** The screensavers of the project */
    candidates: ScreensaverCandidate[];
    /** The view that is shown */
    getView: () => string;
    /** Opens a view */
    changeView?: (view: string) => void;
    /** Watch the input and start after the time; off in the editor, where only the preview runs */
    watch: boolean;
    /** Show the first screensaver right away, as the preview of the editor does */
    startShown?: boolean;
    /** The screensaver went away */
    onIdle?: () => void;
}

/**
 * The screensaver: after some minutes without input it lies over whatever view is open, and a touch ends it
 * without switching anything under it.
 *
 * It is rendered into the `body` of the page, above everything vis-2 shows - dialogs included.
 *
 * @param props - the screensavers of the project and what it needs from vis-2
 */
export default function ScreensaverRunner(props: ScreensaverRunnerProps): React.JSX.Element | null {
    // the preview starts invisible, to fade in as the screensaver does
    const preview = props.startShown ? props.candidates[0] || null : null;
    const [phase, setPhase] = React.useState<Phase>(preview ? 'arming' : 'idle');
    const [active, setActive] = React.useState<ScreensaverCandidate | null>(preview);

    // the handlers of the window run outside of React: they read the latest of everything from refs
    const phaseRef = React.useRef<Phase>(phase);
    const activeRef = React.useRef<ScreensaverCandidate | null>(active);
    const propsRef = useLatest(props);
    /** When the last input was; set when the runner starts */
    const lastInput = React.useRef(0);
    const pointerDown = React.useRef(false);
    const swallowUntil = React.useRef(0);
    const mouseStart = React.useRef<{ x: number; y: number } | null>(null);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const oids = React.useMemo(() => {
        const list: string[] = [];
        for (const candidate of props.candidates) {
            list.push(...frameOids(candidate.config), candidate.config.enabledOid, candidate.config.dimOid);
        }
        return [...new Set(list.filter(Boolean))];
    }, [props.candidates]);
    const values = useStateValues(props.socket, oids);
    const valuesRef = useLatest(values);

    const weatherOids = React.useMemo(
        () =>
            props.candidates.flatMap(c => [
                c.config.weather.temperature,
                c.config.weather.wind,
                c.config.weather.humidity,
                c.config.weather.precipitation,
            ]),
        [props.candidates],
    );
    const units = useUnits(props.socket, weatherOids);

    const go = React.useCallback((next: Phase, candidate?: ScreensaverCandidate | null) => {
        phaseRef.current = next;
        setPhase(next);
        if (candidate !== undefined) {
            activeRef.current = candidate;
            setActive(candidate);
        }
    }, []);

    const dismiss = React.useCallback(() => {
        const phaseNow = phaseRef.current;
        if (phaseNow === 'arming') {
            go('idle', null);
            return;
        }
        if (phaseNow !== 'shown') {
            return;
        }
        lastInput.current = Date.now();
        mouseStart.current = null;
        go('closing');
        const finish = (): void => {
            // the overlay stays until the finger is up: the click of the tap goes to where the finger went down
            if (pointerDown.current) {
                closeTimer.current = setTimeout(finish, 100);
                return;
            }
            closeTimer.current = null;
            lastInput.current = Date.now();
            go('idle', null);
            propsRef.current.onIdle?.();
        };
        closeTimer.current = setTimeout(finish, FADE_OUT_MS);
    }, [go, propsRef]);

    // input anywhere on the page: in the capture phase, so that a widget that stops an event cannot hide it
    React.useEffect(() => {
        lastInput.current = Date.now();
        const onInput = (): void => {
            lastInput.current = Date.now();
            if (phaseRef.current === 'arming') {
                go('idle', null);
            }
        };
        const onKey = (e: KeyboardEvent): void => {
            lastInput.current = Date.now();
            if (phaseRef.current === 'shown' || phaseRef.current === 'closing') {
                // the key ends the screensaver and does nothing else
                e.preventDefault();
                e.stopPropagation();
                dismiss();
            } else if (phaseRef.current === 'arming') {
                go('idle', null);
            }
        };
        const onPointerUp = (): void => {
            if (pointerDown.current) {
                pointerDown.current = false;
                swallowUntil.current = Date.now() + SWALLOW_CLICKS_MS;
            }
        };
        // the click of the tap that ended the screensaver, and the mouse events a touch screen makes up after it
        const onClick = (e: MouseEvent): void => {
            if (phaseRef.current === 'closing' || Date.now() < swallowUntil.current) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        const onMove = (e: PointerEvent): void => {
            if (phaseRef.current !== 'shown' || e.pointerType !== 'mouse' || !activeRef.current?.config.endOnMouseMove) {
                return;
            }
            if (!mouseStart.current) {
                mouseStart.current = { x: e.clientX, y: e.clientY };
                return;
            }
            if (Math.hypot(e.clientX - mouseStart.current.x, e.clientY - mouseStart.current.y) > MOUSE_MOVE_PX) {
                dismiss();
            }
        };
        const passive: AddEventListenerOptions = { capture: true, passive: true };
        window.addEventListener('pointerdown', onInput, passive);
        window.addEventListener('touchstart', onInput, passive);
        window.addEventListener('wheel', onInput, passive);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('pointerup', onPointerUp, passive);
        window.addEventListener('pointercancel', onPointerUp, passive);
        window.addEventListener('click', onClick, true);
        window.addEventListener('mousedown', onClick, true);
        window.addEventListener('mouseup', onClick, true);
        window.addEventListener('pointermove', onMove, passive);
        return () => {
            window.removeEventListener('pointerdown', onInput, true);
            window.removeEventListener('touchstart', onInput, true);
            window.removeEventListener('wheel', onInput, true);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            window.removeEventListener('pointercancel', onPointerUp, true);
            window.removeEventListener('click', onClick, true);
            window.removeEventListener('mousedown', onClick, true);
            window.removeEventListener('mouseup', onClick, true);
            window.removeEventListener('pointermove', onMove, true);
            if (closeTimer.current) {
                clearTimeout(closeTimer.current);
            }
        };
    }, [dismiss, go, propsRef]);

    // the time without input, checked once a second: cheap, and it follows a change of the view by itself
    React.useEffect(() => {
        if (!props.watch) {
            return undefined;
        }
        const timer = setInterval(() => {
            const phaseNow = phaseRef.current;
            const values = valuesRef.current;
            if (phaseNow === 'shown') {
                // switched off while it runs, e.g. by the night: it goes
                if (activeRef.current && !isEnabled(activeRef.current.config, values)) {
                    dismiss();
                }
                return;
            }
            if (phaseNow === 'closing') {
                return;
            }
            const candidate = pickCandidate(propsRef.current.candidates, propsRef.current.getView());
            const delay = delayOf(candidate, values);
            if (!delay || !candidate) {
                if (phaseNow === 'arming') {
                    go('idle', null);
                }
                return;
            }
            const idle = Date.now() - lastInput.current;
            if (idle >= delay) {
                mouseStart.current = null;
                go('shown', candidate);
            } else if (idle >= delay - ARM_MS && phaseNow === 'idle') {
                go('arming', candidate);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [props.watch, dismiss, go, propsRef, valuesRef]);

    // the preview of the editor: in the page invisible first, then faded in
    React.useEffect(() => {
        if (!preview) {
            return undefined;
        }
        let frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => go('shown', preview));
        });
        return () => window.cancelAnimationFrame(frame);
        // only when it starts
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // the view to come back to is opened while the screensaver covers it
    React.useEffect(() => {
        if (phase !== 'shown' || !active?.config.afterView || !props.changeView) {
            return undefined;
        }
        const target = active.config.afterView;
        const timer = setTimeout(() => {
            if (phaseRef.current === 'shown' && propsRef.current.getView() !== target) {
                propsRef.current.changeView?.(target);
            }
        }, FADE_IN_MS + 200);
        return () => clearTimeout(timer);
    }, [phase, active, props.changeView, propsRef]);

    if (phase === 'idle' || !active || typeof document === 'undefined') {
        return null;
    }

    const stop = (e: React.SyntheticEvent): void => {
        e.preventDefault();
        e.stopPropagation();
    };

    const visible = phase === 'shown';
    return createPortal(
        <div
            role="presentation"
            onPointerDown={e => {
                stop(e);
                if (phaseRef.current === 'shown') {
                    pointerDown.current = true;
                    dismiss();
                }
            }}
            onPointerUp={stop}
            onMouseDown={stop}
            onMouseUp={stop}
            onClick={stop}
            onDoubleClick={stop}
            onContextMenu={stop}
            // no mouse events made up from the touch: they would land on the view once the screensaver is gone
            onTouchEnd={stop}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2147483000,
                background: '#000',
                opacity: visible ? 1 : 0,
                visibility: phase === 'arming' ? 'hidden' : 'visible',
                pointerEvents: phase === 'arming' ? 'none' : 'auto',
                transition: visible ? `opacity ${FADE_IN_MS}ms ease` : `opacity ${FADE_OUT_MS}ms ease`,
                cursor: 'none',
                touchAction: 'none',
                overscrollBehavior: 'none',
            }}
        >
            <SlideShow
                config={active.config}
                socket={props.socket}
                project={props.project}
                values={values}
                units={units}
                editMode={false}
                dark
                brightness={brightnessOf(active.config, values)}
                resumeKey={resumeKeys.get(active.id)}
                onShow={key => resumeKeys.set(active.id, key)}
            />
        </div>,
        document.body,
    );
}
