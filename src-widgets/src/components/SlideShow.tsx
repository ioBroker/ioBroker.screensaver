import React from 'react';

import type { Connection } from '@iobroker/gui-components';

import type { FrameConfig } from '../lib/config';
import { useElementSize, useLatest, type Size } from '../lib/hooks';
import { getLanguage, t } from '../lib/i18n';
import { preparePhoto, type PreparedPhoto, type TargetSize } from '../lib/photoLoader';
import { SlideEngine, isPortrait, type EngineSnapshot, type EngineTimers, type Layer } from '../lib/slideEngine';
import { useImageList, type ListError, type ProjectLocation } from '../lib/useImageList';
import Caption from './Caption';
import InfoPanel from './InfoPanel';
import { KEN_BURNS_VARIANTS, TEXT_SHADOW, ensureStyles } from './styles';

export interface SlideShowCommand {
    kind: 'next' | 'prev';
    /** Counts up with every command, so that the same command twice is two commands */
    seq: number;
}

export interface SlideShowProps {
    config: FrameConfig;
    socket: Connection | null | undefined;
    project: ProjectLocation;
    /** The values of the states the frame uses, by object ID */
    values: Record<string, unknown>;
    /** The units of the weather states */
    units: Record<string, string>;
    /** Next or previous picture, from a state */
    command?: SlideShowCommand | null;
    /** Write the pause state: where it is set, a tap writes it instead of pausing only this frame */
    onWritePause?: (paused: boolean) => void;
    editMode: boolean;
    /** The colour of the messages of an empty frame: the secondary text colour of the theme */
    mutedColor?: string;
    /** Dark: the screensaver, which has no card behind it */
    dark?: boolean;
    /** 1 is full brightness; the screensaver dims below it at night */
    brightness?: number;
    /** Go on after this picture */
    resumeKey?: string;
    /** A picture came on the screen */
    onShow?: (key: string) => void;
}

const TIMERS: EngineTimers = {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: handle => window.clearTimeout(handle as number),
    nextFrame: fn => {
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => fn());
        } else {
            window.setTimeout(fn, 16);
        }
    },
};

const EMPTY_SNAPSHOT: EngineSnapshot = { layers: [], position: 0, total: 0, paused: false, status: 'empty' };

/** Below this a swipe is a tap */
const SWIPE_DISTANCE = 40;

/** The gap between the two pictures of a pair */
const PAIR_GAP = 4;

function isTrue(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

/**
 * The style of a layer in its transition. Only `opacity` and `transform` change: the browser animates them on
 * the graphics chip without drawing the picture again.
 *
 * @param layer - the layer
 * @param transition - the kind of transition
 * @param ms - its duration
 */
function layerStyle(layer: Layer, transition: FrameConfig['transition'], ms: number): React.CSSProperties {
    const base: React.CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' };
    const zIndex = layer.phase === 'leave' ? 1 : 2;
    if (transition === 'slide' && ms > 0) {
        const x = layer.phase === 'enter' ? layer.dir * 100 : layer.phase === 'leave' ? -layer.dir * 100 : 0;
        return {
            ...base,
            zIndex,
            transform: `translate3d(${x}%, 0, 0)`,
            transition: layer.phase === 'enter' ? 'none' : `transform ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`,
            willChange: 'transform',
        };
    }
    if (transition === 'fade' && ms > 0) {
        // the new picture fades in over the old one, which stays: no dip into black in the middle
        return {
            ...base,
            zIndex,
            opacity: layer.phase === 'enter' ? 0 : 1,
            transition: layer.phase === 'active' ? `opacity ${ms}ms ease-in-out` : 'none',
            willChange: 'opacity',
        };
    }
    return { ...base, zIndex };
}

interface PhotoCellProps {
    photo: PreparedPhoto;
    config: FrameConfig;
    cell: Size;
    lang: string;
    kenBurns: React.CSSProperties | undefined;
    captionPosition: 'bottomLeft' | 'bottomRight' | 'off';
}

function PhotoCell(props: PhotoCellProps): React.JSX.Element {
    const { photo, config, cell } = props;
    const contain = config.fit === 'contain';
    // a portrait photo cropped into a wide frame keeps its upper part: that is where the faces are
    const portraitCropped = !contain && isPortrait(photo) && cell.width > cell.height;

    return (
        <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
            {contain && photo.backdrop ? (
                <div
                    style={{
                        position: 'absolute',
                        inset: '-6%',
                        backgroundImage: `url(${photo.backdrop})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(10px)',
                    }}
                />
            ) : null}
            <div
                className={props.kenBurns ? 'vis2ss-kb' : undefined}
                style={{ position: 'absolute', inset: 0, ...props.kenBurns }}
            >
                <img
                    src={photo.src}
                    alt={photo.ref.caption || ''}
                    draggable={false}
                    style={{
                        display: 'block',
                        width: '100%',
                        height: '100%',
                        objectFit: contain ? 'contain' : 'cover',
                        objectPosition: portraitCropped ? '50% 30%' : '50% 50%',
                    }}
                />
            </div>
            {props.captionPosition !== 'off' ? (
                <Caption
                    photo={photo}
                    config={config}
                    lang={props.lang}
                    width={cell.width}
                    height={cell.height}
                    position={props.captionPosition}
                />
            ) : null}
        </div>
    );
}

interface SlideLayerProps {
    layer: Layer;
    config: FrameConfig;
    size: Size;
    lang: string;
    transitionMs: number;
    kenBurnsMs: number;
    paused: boolean;
    captionPosition: 'bottomLeft' | 'bottomRight' | 'off';
}

const SlideLayer = React.memo(function SlideLayer(props: SlideLayerProps): React.JSX.Element {
    const { layer, config, size } = props;
    const photos = layer.slide.photos;
    const pair = photos.length > 1;
    const cell: Size = pair ? { width: (size.width - PAIR_GAP) / 2, height: size.height } : size;
    const kenBurns: React.CSSProperties | undefined = config.kenBurns
        ? {
              animation: `vis2ss-kb-${layer.slide.id % KEN_BURNS_VARIANTS} ${props.kenBurnsMs}ms linear forwards`,
              animationPlayState: props.paused ? 'paused' : 'running',
              willChange: 'transform',
          }
        : undefined;

    return (
        <div style={layerStyle(layer, config.transition, props.transitionMs)}>
            <div style={{ display: 'flex', gap: PAIR_GAP, width: '100%', height: '100%' }}>
                {photos.map((photo, i) => (
                    <PhotoCell
                        key={i}
                        photo={photo}
                        config={config}
                        cell={cell}
                        lang={props.lang}
                        kenBurns={kenBurns}
                        // in a pair each picture has its own caption, the clock's corner stays free
                        captionPosition={pair ? (i === 0 ? 'bottomLeft' : 'bottomRight') : props.captionPosition}
                    />
                ))}
            </div>
        </div>
    );
});

function PauseIcon(props: { size: number }): React.JSX.Element {
    return (
        <svg
            viewBox="0 0 24 24"
            width={props.size}
            height={props.size}
            fill="currentColor"
            aria-hidden="true"
        >
            <rect
                x="6"
                y="5"
                width="4"
                height="14"
                rx="1"
            />
            <rect
                x="14"
                y="5"
                width="4"
                height="14"
                rx="1"
            />
        </svg>
    );
}

function FlashIcon(props: { kind: 'pause' | 'play' | 'next' | 'prev'; size: number }): React.JSX.Element {
    if (props.kind === 'pause') {
        return <PauseIcon size={props.size} />;
    }
    const path = props.kind === 'play' ? 'M8 5v14l11-7z' : props.kind === 'next' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6';
    return (
        <svg
            viewBox="0 0 24 24"
            width={props.size}
            height={props.size}
            fill={props.kind === 'play' ? 'currentColor' : 'none'}
            stroke={props.kind === 'play' ? 'none' : 'currentColor'}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={path} />
        </svg>
    );
}

/** The position in the list: dots for a few pictures, a number for many */
function Position(props: {
    position: number;
    span: number;
    total: number;
    paused: boolean;
    size: Size;
}): React.JSX.Element {
    const dot = Math.max(6, Math.min(12, Math.min(props.size.width, props.size.height) * 0.018));
    const bottom = Math.max(6, Math.min(props.size.width, props.size.height) * 0.035);
    return (
        <div
            style={{
                position: 'absolute',
                left: '50%',
                bottom,
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: dot * 0.9,
                zIndex: 6,
                pointerEvents: 'none',
                color: '#fff',
                filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5))',
            }}
        >
            {props.paused ? <PauseIcon size={dot * 1.8} /> : null}
            {props.total <= 12 ? (
                Array.from({ length: props.total }, (_v, i) => {
                    const on = i >= props.position && i < props.position + props.span;
                    return (
                        <div
                            key={i}
                            style={{
                                width: dot,
                                height: dot,
                                borderRadius: '50%',
                                background: on ? '#fff' : 'rgba(255, 255, 255, 0.45)',
                                transition: 'background 0.3s',
                            }}
                        />
                    );
                })
            ) : (
                <div
                    style={{
                        fontSize: dot * 1.3,
                        padding: `${dot * 0.15}px ${dot * 0.7}px`,
                        borderRadius: dot,
                        background: 'rgba(0, 0, 0, 0.3)',
                        fontVariantNumeric: 'tabular-nums',
                    }}
                >
                    {`${props.position + 1} / ${props.total}`}
                </div>
            )}
        </div>
    );
}

/** What the frame says while it has no picture to show */
function Message(props: { text: string; spinner?: boolean; color: string }): React.JSX.Element {
    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: 16,
                boxSizing: 'border-box',
                textAlign: 'center',
                color: props.color,
                fontSize: 13,
                zIndex: 6,
                pointerEvents: 'none',
            }}
        >
            {props.spinner ? (
                <div
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        border: `3px solid ${props.color}`,
                        borderTopColor: 'transparent',
                        opacity: 0.6,
                        animation: 'vis2ss-spin 1s linear infinite',
                    }}
                />
            ) : (
                <svg
                    viewBox="0 0 24 24"
                    width={36}
                    height={36}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: 0.7 }}
                    aria-hidden="true"
                >
                    <rect
                        x="3"
                        y="4"
                        width="18"
                        height="16"
                        rx="2"
                    />
                    <circle
                        cx="9"
                        cy="9.5"
                        r="1.8"
                    />
                    <path d="M21 16l-5.5-5.5L5 20" />
                </svg>
            )}
            {props.text ? <div style={{ maxWidth: 360 }}>{props.text}</div> : null}
        </div>
    );
}

/**
 * Why a frame has no pictures, in words
 *
 * @param error - the reason
 * @param config - the settings
 * @param values - the values of the states, for the album state
 * @param reason - why the adapter cannot read the album, in its words
 */
function errorText(error: ListError, config: FrameConfig, values: Record<string, unknown>, reason?: string): string {
    const fromState = config.albumOid ? values[config.albumOid] : undefined;
    const album = (typeof fromState === 'string' && fromState.trim()) || config.album;
    switch (error) {
        case 'folder_unsupported':
            return t('folder_unsupported');
        case 'album_not_found':
            return t('album_not_found', album);
        case 'album_failed':
            return reason ? `${t('album_failed', album)} (${reason})` : t('album_failed', album);
        case 'album_unreachable':
            return t('album_unreachable', config.instance);
        default:
            return t('folder_not_found', config.folder);
    }
}

/**
 * The slideshow: pictures from a folder, a list or a state, one after the other, with the transition, the slow
 * zoom, the captions and the clock.
 *
 * It fills the box it is put into - a cell of the grid, a page, the whole screen - and takes all its sizes from
 * that box. Used by the photo frame widget and by the screensaver alike.
 *
 * @param props - the settings and the values of the states
 */
export default function SlideShow(props: SlideShowProps): React.JSX.Element {
    const { config } = props;
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const size = useElementSize(rootRef);
    const lang = getLanguage();

    // into the shadow root when the frame is part of a web component: the styles of the page do not reach it
    React.useEffect(() => ensureStyles(rootRef.current?.getRootNode()), []);

    const list = useImageList(
        config,
        props.socket,
        props.project,
        config.listOid ? props.values[config.listOid] : undefined,
        config.albumOid ? props.values[config.albumOid] : undefined,
    );

    const externalPause = !!config.pauseOid;
    const [localPaused, setLocalPaused] = React.useState(false);
    const paused = externalPause ? isTrue(props.values[config.pauseOid]) : localPaused;

    const [snap, setSnap] = React.useState<EngineSnapshot>(EMPTY_SNAPSHOT);
    const engineRef = React.useRef<SlideEngine | null>(null);

    const readMeta = config.showDate || config.placeSource !== 'off' || config.showPhotoCaption;
    const readMetaRef = useLatest(readMeta);
    const reloadRef = useLatest(list.reload);
    const onShowRef = useLatest(props.onShow);

    React.useEffect(() => {
        const engine = new SlideEngine(
            (ref, target, signal) => preparePhoto(ref, target, signal, readMetaRef.current),
            setSnap,
            TIMERS,
        );
        engineRef.current = engine;
        return () => {
            engine.destroy();
            engineRef.current = null;
        };
        // the refs never change: the engine lives as long as the slideshow
    }, [readMetaRef]);

    // loaded a little larger than the frame where it zooms, in steps, so that a resize by a few pixels is no reason
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const zoom = config.kenBurns ? 1.12 : 1;
    const step = (value: number): number => Math.ceil((value * dpr * zoom) / 64) * 64;
    const targetWidth = size && size.width > 8 ? step(size.width) : 0;
    const targetHeight = size && size.height > 8 ? step(size.height) : 0;
    const target = React.useMemo<TargetSize | null>(
        () => (targetWidth && targetHeight ? { width: targetWidth, height: targetHeight } : null),
        [targetWidth, targetHeight],
    );
    const landscape = !!size && size.height > 0 && size.width / size.height >= 1.2;

    React.useEffect(() => {
        engineRef.current?.update({
            photos: list.photos,
            order: config.order,
            intervalMs: config.interval * 1000,
            transition: config.transition,
            transitionMs: config.transition === 'none' ? 0 : config.transitionTime * 1000,
            paused,
            pairPortraits: config.pairPortraits,
            target,
            landscape,
            startAfterKey: props.resumeKey,
            onWrap: () => reloadRef.current(),
            onShow: slide => {
                const key = slide.photos[slide.photos.length - 1]?.ref.key;
                if (key) {
                    onShowRef.current?.(key);
                }
            },
        });
    }, [
        reloadRef,
        onShowRef,
        list.photos,
        config.order,
        config.interval,
        config.transition,
        config.transitionTime,
        paused,
        config.pairPortraits,
        target,
        landscape,
        props.resumeKey,
    ]);

    // next and previous from a state
    const lastCommand = React.useRef(props.command?.seq);
    React.useEffect(() => {
        const command = props.command;
        if (!command || command.seq === lastCommand.current) {
            return;
        }
        lastCommand.current = command.seq;
        if (command.kind === 'next') {
            engineRef.current?.next();
        } else {
            engineRef.current?.prev();
        }
    }, [props.command]);

    // a symbol in the middle that says what a tap did
    const [flash, setFlash] = React.useState<{ kind: 'pause' | 'play' | 'next' | 'prev'; id: number } | null>(null);
    React.useEffect(() => {
        if (!flash) {
            return undefined;
        }
        const timer = setTimeout(() => setFlash(null), 900);
        return () => clearTimeout(timer);
    }, [flash]);

    const interactive = config.interactive && !props.editMode;
    const pointer = React.useRef<{ x: number; y: number; t: number; id: number } | null>(null);

    const show = (kind: 'pause' | 'play' | 'next' | 'prev'): void => setFlash({ kind, id: Date.now() });

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        if (!interactive || (e.pointerType === 'mouse' && e.button !== 0)) {
            return;
        }
        pointer.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
        const start = pointer.current;
        pointer.current = null;
        const engine = engineRef.current;
        if (!interactive || !start || start.id !== e.pointerId || !engine || !rootRef.current) {
            return;
        }
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0) {
                engine.next();
                show('next');
            } else {
                engine.prev();
                show('prev');
            }
            return;
        }
        // a drag that was no swipe, or a long press: nothing
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || Date.now() - start.t > 800) {
            return;
        }
        const rect = rootRef.current.getBoundingClientRect();
        const x = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
        if (x < 0.25) {
            engine.prev();
            show('prev');
        } else if (x > 0.75) {
            engine.next();
            show('next');
        } else if (externalPause) {
            props.onWritePause?.(!paused);
            show(paused ? 'play' : 'pause');
        } else {
            setLocalPaused(!paused);
            show(paused ? 'play' : 'pause');
        }
    };

    const brightness = props.brightness ?? 1;
    const hasLayers = snap.layers.length > 0;
    const active = snap.layers[snap.layers.length - 1];
    const transitionMs = config.transition === 'none' ? 0 : config.transitionTime * 1000;
    // the zoom runs a little longer than the picture stands, so it never comes to a halt in front of the viewer
    const kenBurnsMs = (config.interval + config.transitionTime * 2) * 1000;
    const showsInfo = config.showClock || !!(config.weather.temperature || config.weather.text || config.weather.icon);
    // a caption in the corner of the clock moves to the other corner
    const captionPosition =
        showsInfo && config.captionPosition === config.infoPosition
            ? config.captionPosition === 'bottomLeft'
                ? 'bottomRight'
                : 'bottomLeft'
            : config.captionPosition;

    const quiet = props.dark ? 'rgba(255, 255, 255, 0.7)' : props.mutedColor || 'rgba(128, 128, 128, 0.9)';
    let message: React.JSX.Element | null = null;
    if (!hasLayers) {
        const noSource =
            (config.source === 'folder' && !config.folder && !(config.albumOid && props.values[config.albumOid])) ||
            (config.source === 'list' && !config.urls.trim()) ||
            (config.source === 'state' && !config.listOid) ||
            (config.source === 'adapter' && !config.album && !(config.albumOid && props.values[config.albumOid]));
        if (noSource) {
            message = (
                <Message
                    text={t('choose_source')}
                    color={quiet}
                />
            );
        } else if (list.error) {
            message = (
                <Message
                    text={errorText(list.error, config, props.values, list.reason)}
                    color={quiet}
                />
            );
        } else if (snap.status === 'error') {
            message = (
                <Message
                    text={t('cannot_load')}
                    color={quiet}
                />
            );
        } else if (snap.status === 'empty' && !list.loading) {
            message = (
                <Message
                    text={t('no_pictures')}
                    color={quiet}
                />
            );
        } else {
            message = (
                <Message
                    text=""
                    spinner
                    color={quiet}
                />
            );
        }
    }

    return (
        <div
            ref={rootRef}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (pointer.current = null)}
            onContextMenu={interactive ? e => e.preventDefault() : undefined}
            style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                zIndex: 0,
                background: hasLayers || props.dark ? '#000' : undefined,
                touchAction: interactive ? 'pan-y' : undefined,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                cursor: interactive ? 'pointer' : undefined,
            }}
        >
            {size
                ? snap.layers.map(layer => (
                      <SlideLayer
                          key={layer.slide.id}
                          layer={layer}
                          config={config}
                          size={size}
                          lang={lang}
                          transitionMs={transitionMs}
                          kenBurnsMs={kenBurnsMs}
                          paused={snap.paused}
                          captionPosition={captionPosition}
                      />
                  ))
                : null}
            {brightness < 1 ? (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 3,
                        background: '#000',
                        opacity: Math.min(1, Math.max(0, 1 - brightness)),
                        transition: 'opacity 1s',
                        pointerEvents: 'none',
                    }}
                />
            ) : null}
            {size && (hasLayers || props.dark) ? (
                <div style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none' }}>
                    <InfoPanel
                        config={config}
                        size={size}
                        lang={lang}
                        weather={{
                            temperature: props.values[config.weather.temperature],
                            text: props.values[config.weather.text],
                            icon: props.values[config.weather.icon],
                            wind: props.values[config.weather.wind],
                            humidity: props.values[config.weather.humidity],
                            precipitation: props.values[config.weather.precipitation],
                        }}
                        units={props.units}
                        brightness={brightness < 1 ? brightness : undefined}
                    />
                </div>
            ) : null}
            {size && config.dots && snap.total > 1 && hasLayers ? (
                <Position
                    position={snap.position}
                    span={active?.slide.len || 1}
                    total={snap.total}
                    paused={snap.paused && !props.editMode}
                    size={size}
                />
            ) : null}
            {flash ? (
                <div
                    key={flash.id}
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        zIndex: 7,
                        width: 64,
                        height: 64,
                        borderRadius: '50%',
                        background: 'rgba(0, 0, 0, 0.45)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textShadow: TEXT_SHADOW,
                        pointerEvents: 'none',
                        animation: 'vis2ss-pop 900ms ease-out forwards',
                    }}
                >
                    <FlashIcon
                        kind={flash.kind}
                        size={34}
                    />
                </div>
            ) : null}
            {message}
        </div>
    );
}
