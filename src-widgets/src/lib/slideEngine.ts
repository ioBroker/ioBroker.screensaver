/**
 * The slideshow without React: which picture comes when, what is loaded, and what is on the screen.
 *
 * It keeps as little as it can: the slide on the screen, the one it is fading out of during a transition, and
 * the next one, loaded ahead so that it is ready when its time comes. Everything else is a URL in a list. A
 * slide that leaves the screen gives its memory back at once.
 *
 * The timers come from outside, so the tests can run a whole slideshow in a few milliseconds.
 */

import type { PhotoRef } from './sources';
import type { PreparedPhoto, TargetSize } from './photoLoader';
import type { PlayOrder, TransitionKind } from './config';

/** One screen: a picture, or two portrait pictures side by side */
export interface Slide {
    id: number;
    photos: PreparedPhoto[];
    /** How many places of the order it takes: 1, or 2 for a pair */
    len: number;
}

export type LayerPhase = 'enter' | 'active' | 'leave';

/** A slide on the screen, and where it is in its transition */
export interface Layer {
    slide: Slide;
    phase: LayerPhase;
    /** 1 forwards, -1 backwards: where a sliding picture comes from */
    dir: 1 | -1;
}

export type EngineStatus = 'empty' | 'loading' | 'showing' | 'error';

export interface EngineSnapshot {
    layers: Layer[];
    /** Place of the slide on the screen in the order, from 0 */
    position: number;
    total: number;
    paused: boolean;
    status: EngineStatus;
    /** The picture the last error was about */
    errorUrl?: string;
}

export type PhotoLoaderFn = (ref: PhotoRef, target: TargetSize, signal: AbortSignal) => Promise<PreparedPhoto>;

export interface EngineTimers {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    /** Run after the browser has drawn the current state, so that a CSS transition has a start to go from */
    nextFrame: (fn: () => void) => void;
}

export interface EngineOptions {
    photos: PhotoRef[];
    order: PlayOrder;
    intervalMs: number;
    transition: TransitionKind;
    transitionMs: number;
    paused: boolean;
    pairPortraits: boolean;
    /** How large a picture is shown at most, in device pixels; nothing is loaded before it is known */
    target: TargetSize | null;
    /** The frame is wide enough for two portrait pictures side by side */
    landscape: boolean;
    /** Start after this picture: to go on where a screensaver stopped the last time */
    startAfterKey?: string;
    /** The order went round once: a folder is worth reading again */
    onWrap?: () => void;
    /** A slide is on the screen */
    onShow?: (slide: Slide) => void;
}

const DEFAULT_OPTIONS: EngineOptions = {
    photos: [],
    order: 'sequential',
    intervalMs: 10000,
    transition: 'fade',
    transitionMs: 1500,
    paused: false,
    pairPortraits: true,
    target: null,
    landscape: true,
};

/** After every picture failed: try again after this time, a network or a server may come back */
const RETRY_AFTER_ERROR_MS = 30000;

interface SlideRequest {
    pos: number;
    pair: boolean;
    controller: AbortController;
    promise: Promise<Slide>;
    slide?: Slide;
}

/**
 * A picture is portrait if it is clearly higher than wide
 *
 * @param photo - the loaded picture
 * @param photo.width - its width as shown
 * @param photo.height - its height as shown
 */
export function isPortrait(photo: { width: number; height: number }): boolean {
    return photo.height > photo.width * 1.05;
}

/**
 * A random order of `count` places that does not start with `avoidFirst`, so the same picture is not shown twice
 * in a row when the order goes round
 *
 * @param count - how many places
 * @param avoidFirst - the place that must not come first
 * @param random - the source of randomness
 */
export function shuffledOrder(count: number, avoidFirst = -1, random: () => number = Math.random): number[] {
    const order = Array.from({ length: count }, (_v, i) => i);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    if (count > 1 && order[0] === avoidFirst) {
        const swap = 1 + Math.floor(random() * (count - 1));
        [order[0], order[swap]] = [order[swap], order[0]];
    }
    return order;
}

export class SlideEngine {
    private options: EngineOptions = { ...DEFAULT_OPTIONS };

    /** Indexes into `options.photos`, in the order they are shown */
    private order: number[] = [];

    /** Place in `order` of the slide on the screen */
    private pos = 0;

    private current: Slide | null = null;

    private layers: Layer[] = [];

    /** The slide being loaded or loaded ahead */
    private request: SlideRequest | null = null;

    /** The request the slideshow is waiting for, to show it as soon as it is there */
    private waiting: { request: SlideRequest; dir: 1 | -1 } | null = null;

    /** A picture loaded to see whether it pairs with the one before, that turned out not to: the next slide takes it */
    private carry: { pos: number; photo: PreparedPhoto } | null = null;

    /** Where the slide after the one on the screen is, worked out once per slide: in random order it shuffles */
    private upcoming: { slideId: number; pos: number } | null = null;

    private advanceTimer: unknown = null;

    private transitionTimer: unknown = null;

    private retryTimer: unknown = null;

    private failures = 0;

    private errorUrl: string | undefined;

    private status: EngineStatus = 'empty';

    private slideIds = 0;

    private destroyed = false;

    private started = false;

    constructor(
        private readonly loader: PhotoLoaderFn,
        private readonly onChange: (snapshot: EngineSnapshot) => void,
        private readonly timers: EngineTimers,
        private readonly random: () => number = Math.random,
    ) {}

    /**
     * Change what the slideshow shows or how. Only what is given changes.
     *
     * @param changes - the options that changed
     */
    update(changes: Partial<EngineOptions>): void {
        if (this.destroyed) {
            return;
        }
        const before = this.options;
        this.options = { ...before, ...changes };

        if (changes.photos && changes.photos !== before.photos) {
            this.setPhotos(before.photos, changes.photos);
        }
        if (changes.order && changes.order !== before.order) {
            this.rebuildOrder();
        }
        if (changes.paused !== undefined && changes.paused !== before.paused) {
            if (this.options.paused) {
                this.clearAdvance();
            } else {
                this.scheduleAdvance();
            }
            this.emit();
        }
        if (changes.intervalMs !== undefined && changes.intervalMs !== before.intervalMs && this.advanceTimer) {
            this.scheduleAdvance();
        }
        this.kick();
    }

    /** Show the next slide now */
    next(): void {
        if (!this.current) {
            this.kick();
            return;
        }
        if (this.order.length < 2) {
            return;
        }
        this.goTo(this.upcomingPos(), 1, true);
    }

    /** Show the slide before now */
    prev(): void {
        if (!this.current || this.order.length < 2) {
            return;
        }
        const count = this.order.length;
        // backwards a single picture: a pair is only made going forwards
        this.goTo((this.pos - 1 + count) % count, -1, false);
    }

    setPaused(paused: boolean): void {
        this.update({ paused });
    }

    togglePause(): void {
        this.update({ paused: !this.options.paused });
    }

    get paused(): boolean {
        return this.options.paused;
    }

    /** The picture on the screen, to go on from there next time */
    get currentKey(): string | undefined {
        return this.current?.photos[this.current.photos.length - 1]?.ref.key;
    }

    /** Stop everything and give back all memory */
    destroy(): void {
        this.destroyed = true;
        this.clearAdvance();
        this.clearTimer('transitionTimer');
        this.clearTimer('retryTimer');
        this.waiting = null;
        this.dropRequest();
        this.dropCarry();
        for (const layer of this.layers) {
            this.releaseSlide(layer.slide);
        }
        this.layers = [];
        this.current = null;
    }

    snapshot(): EngineSnapshot {
        return {
            layers: this.layers,
            position: this.pos,
            total: this.order.length,
            paused: this.options.paused,
            status: this.status,
            errorUrl: this.errorUrl,
        };
    }

    private emit(): void {
        if (!this.destroyed) {
            this.onChange(this.snapshot());
        }
    }

    private clearTimer(name: 'advanceTimer' | 'transitionTimer' | 'retryTimer'): void {
        if (this[name]) {
            this.timers.clearTimeout(this[name]);
            this[name] = null;
        }
    }

    private clearAdvance(): void {
        this.clearTimer('advanceTimer');
    }

    private scheduleAdvance(): void {
        this.clearAdvance();
        // not during a transition: the time a picture stands starts when it stands
        if (this.destroyed || this.options.paused || !this.current || this.order.length < 2 || this.transitionTimer) {
            return;
        }
        this.advanceTimer = this.timers.setTimeout(() => {
            this.advanceTimer = null;
            this.next();
        }, this.options.intervalMs);
    }

    /** Start the slideshow once there is something to show and a size to load it for */
    private kick(): void {
        if (this.destroyed || this.current || this.waiting || this.retryTimer) {
            return;
        }
        if (!this.order.length) {
            this.setStatus('empty');
            return;
        }
        if (!this.options.target) {
            // the size of the frame decides how large the pictures are loaded
            this.setStatus('loading');
            return;
        }
        let start = 0;
        if (!this.started && this.options.startAfterKey) {
            const index = this.options.photos.findIndex(ref => ref.key === this.options.startAfterKey);
            const place = index === -1 ? -1 : this.order.indexOf(index);
            if (place !== -1) {
                start = (place + 1) % this.order.length;
            }
        }
        this.started = true;
        this.setStatus('loading');
        this.goTo(start, 1, true);
    }

    private setStatus(status: EngineStatus): void {
        if (status !== this.status) {
            this.status = status;
            this.emit();
        }
    }

    private rebuildOrder(): void {
        const count = this.options.photos.length;
        const currentIndex = this.current ? this.order[this.pos] : -1;
        this.order =
            this.options.order === 'random'
                ? shuffledOrder(count, -1, this.random)
                : Array.from({ length: count }, (_v, i) => i);
        if (currentIndex !== -1 && currentIndex < count) {
            this.pos = Math.max(0, this.order.indexOf(currentIndex));
        } else {
            this.pos = Math.min(this.pos, Math.max(0, count - 1));
        }
        this.invalidateAhead();
    }

    /**
     * The list of pictures changed: a photo was added to the folder, or the state got a new list.
     *
     * The picture on the screen stays, and the slideshow goes on from it. In order, a new picture takes its
     * place by name; in random order it comes right after the one on the screen, so that whoever just put it
     * into the folder sees it next.
     */
    private setPhotos(before: PhotoRef[], photos: PhotoRef[]): void {
        const byKey = new Map(photos.map((ref, i) => [ref.key, i]));

        // keep the captions and dates of the list up to date in what is already loaded
        const refresh = (slide: Slide | undefined): void =>
            slide?.photos.forEach(photo => {
                const index = byKey.get(photo.ref.key);
                if (index !== undefined) {
                    photo.ref = photos[index];
                }
            });
        this.layers.forEach(layer => refresh(layer.slide));
        refresh(this.request?.slide);

        if (!photos.length) {
            this.order = [];
            this.pos = 0;
            this.clearAdvance();
            this.waiting = null;
            this.dropRequest();
            this.dropCarry();
            this.clearTimer('transitionTimer');
            this.layers.forEach(layer => this.releaseSlide(layer.slide));
            this.layers = [];
            this.current = null;
            this.failures = 0;
            this.setStatus('empty');
            this.emit();
            return;
        }

        const currentKey = this.current?.photos[0]?.ref.key;

        if (this.options.order === 'random') {
            const kept: number[] = [];
            for (const index of this.order) {
                const key = before[index]?.key;
                const now = key === undefined ? undefined : byKey.get(key);
                if (now !== undefined) {
                    kept.push(now);
                }
            }
            const keptSet = new Set(kept);
            const added = shuffledOrder(photos.length, -1, this.random).filter(i => !keptSet.has(i));
            const currentNow = currentKey === undefined ? undefined : byKey.get(currentKey);
            const at = currentNow === undefined ? Math.min(this.pos, kept.length) : kept.indexOf(currentNow) + 1;
            this.order = [...kept.slice(0, at), ...added, ...kept.slice(at)];
            this.pos = currentNow === undefined ? Math.min(this.pos, this.order.length - 1) : at - 1;
        } else {
            this.order = Array.from({ length: photos.length }, (_v, i) => i);
            const currentNow = currentKey === undefined ? undefined : byKey.get(currentKey);
            this.pos = currentNow ?? Math.min(this.pos, photos.length - 1);
        }
        this.pos = Math.max(0, this.pos);
        this.failures = 0;

        this.invalidateAhead();
        if (this.current && !this.transitionTimer && !this.waiting) {
            this.preloadNext();
            if (!this.advanceTimer) {
                this.scheduleAdvance();
            }
        }
        this.emit();
    }

    /** What was loaded ahead may stand at another place now */
    private invalidateAhead(): void {
        this.upcoming = null;
        if (!this.waiting) {
            this.dropRequest();
        }
        this.dropCarry();
    }

    /** Where the slide after the one on the screen is */
    private upcomingPos(): number {
        const slideId = this.current?.id ?? -1;
        if (this.upcoming?.slideId === slideId) {
            return this.upcoming.pos;
        }
        const count = this.order.length;
        const len = this.current?.len ?? 1;
        let pos = this.pos + len;
        if (pos >= count) {
            pos %= count;
            if (this.options.order === 'random' && count > 2) {
                // a new round in a new order, not starting with what is on the screen
                const lastIndex = this.order[this.pos];
                this.order = shuffledOrder(count, lastIndex, this.random);
                this.pos = this.order.indexOf(lastIndex);
                pos = 0;
                this.dropCarry();
            }
            this.options.onWrap?.();
        }
        this.upcoming = { slideId, pos };
        return pos;
    }

    private releaseSlide(slide: Slide): void {
        slide.photos.forEach(photo => photo.release());
    }

    private dropCarry(): void {
        this.carry?.photo.release();
        this.carry = null;
    }

    private dropRequest(): void {
        const request = this.request;
        if (!request) {
            return;
        }
        this.request = null;
        request.controller.abort();
        if (request.slide) {
            this.releaseSlide(request.slide);
        }
    }

    /**
     * The slide at a place of the order, loaded or being loaded
     *
     * @param pos - the place
     * @param pair - whether two portrait pictures may be paired
     */
    private requestSlide(pos: number, pair: boolean): SlideRequest {
        if (this.request && this.request.pos === pos && this.request.pair === pair) {
            return this.request;
        }
        this.dropRequest();
        const controller = new AbortController();
        const request: SlideRequest = {
            pos,
            pair,
            controller,
            promise: this.buildSlide(pos, pair, controller.signal).then(slide => {
                if (controller.signal.aborted) {
                    this.releaseSlide(slide);
                    throw new Error('aborted');
                }
                request.slide = slide;
                return slide;
            }),
        };
        // the error is handled by whoever waits for it; a slide loaded ahead and never used has none to report
        request.promise.catch(() => undefined);
        this.request = request;
        return request;
    }

    private async loadAt(pos: number, signal: AbortSignal): Promise<PreparedPhoto> {
        if (this.carry && this.carry.pos === pos) {
            const photo = this.carry.photo;
            this.carry = null;
            return photo;
        }
        const ref = this.options.photos[this.order[pos]];
        if (!ref) {
            throw new Error('No picture at this place');
        }
        // the frame may grow later; a little more than its size keeps the zoom sharp
        return this.loader(ref, this.options.target || { width: 1280, height: 800 }, signal);
    }

    private async buildSlide(pos: number, pair: boolean, signal: AbortSignal): Promise<Slide> {
        const first = await this.loadAt(pos, signal);
        const count = this.order.length;
        if (
            pair &&
            this.options.pairPortraits &&
            this.options.landscape &&
            count > 2 &&
            isPortrait(first) &&
            pos + 1 < count
        ) {
            let second: PreparedPhoto | null = null;
            try {
                second = await this.loadAt(pos + 1, signal);
            } catch (e) {
                if (signal.aborted) {
                    first.release();
                    throw e;
                }
                // the partner does not load: the first one is shown alone, the failure comes up in its turn
            }
            if (second) {
                if (signal.aborted) {
                    first.release();
                    second.release();
                    throw new Error('aborted');
                }
                if (isPortrait(second)) {
                    return { id: ++this.slideIds, photos: [first, second], len: 2 };
                }
                this.dropCarry();
                this.carry = { pos: pos + 1, photo: second };
            }
        }
        return { id: ++this.slideIds, photos: [first], len: 1 };
    }

    /** Load the slide after the one on the screen, so that it is ready when its time comes */
    private preloadNext(): void {
        if (this.destroyed || !this.current || this.order.length < 2) {
            return;
        }
        this.requestSlide(this.upcomingPos(), true);
    }

    private goTo(pos: number, dir: 1 | -1, pair: boolean): void {
        if (this.destroyed) {
            return;
        }
        this.clearAdvance();
        this.clearTimer('retryTimer');
        const request = this.requestSlide(pos, pair);
        const waiting = { request, dir };
        this.waiting = waiting;
        if (!this.current) {
            this.setStatus('loading');
        }
        request.promise.then(
            slide => {
                if (this.waiting !== waiting || this.destroyed) {
                    return;
                }
                this.waiting = null;
                if (this.request === request) {
                    this.request = null;
                }
                this.pos = pos;
                this.show(slide, dir);
            },
            (error: unknown) => {
                if (this.waiting !== waiting || this.destroyed || request.controller.signal.aborted) {
                    return;
                }
                this.waiting = null;
                if (this.request === request) {
                    this.request = null;
                }
                this.onLoadError(pos, dir, error);
            },
        );
    }

    private onLoadError(pos: number, dir: 1 | -1, error: unknown): void {
        const count = this.order.length;
        const ref = this.options.photos[this.order[pos]];
        this.errorUrl = ref?.url;
        this.failures++;
        console.warn(`Photo frame: cannot show ${ref?.url}: ${error instanceof Error ? error.message : String(error)}`);
        if (!count) {
            return;
        }
        if (this.failures >= count) {
            this.failures = 0;
            if (this.current) {
                // the slide on the screen stays, and the next round tries again
                this.scheduleAdvance();
                return;
            }
            // nothing loads at all: wait and try again, a server may come back
            this.setStatus('error');
            this.retryTimer = this.timers.setTimeout(() => {
                this.retryTimer = null;
                this.goTo(pos, dir, true);
            }, RETRY_AFTER_ERROR_MS);
            return;
        }
        this.goTo((pos + dir + count) % count, dir, dir === 1);
    }

    /** Put a slide on the screen, with the transition from the one there before */
    private show(slide: Slide, dir: 1 | -1): void {
        // a transition still running is finished at once: two at a time are what makes a weak tablet stutter
        this.finishTransition(false);

        const animate = this.options.transition !== 'none' && this.options.transitionMs > 0;
        const layers: Layer[] = [];
        for (const layer of this.layers) {
            if (animate) {
                // it leaves the way the new one comes: to the left when the new one comes from the right
                layers.push({ ...layer, phase: 'leave', dir });
            } else {
                this.releaseSlide(layer.slide);
            }
        }
        const entering: Layer = { slide, phase: animate ? 'enter' : 'active', dir };
        layers.push(entering);
        this.layers = layers;
        this.current = slide;
        this.upcoming = null;
        this.failures = 0;
        this.errorUrl = undefined;
        this.status = 'showing';
        this.options.onShow?.(slide);
        this.emit();

        if (!animate) {
            this.finishTransition(true);
            return;
        }
        // a marker that a transition runs, until its end is known
        this.transitionTimer = true;
        // two frames: the entering slide has to be drawn in its start position before it moves
        this.timers.nextFrame(() =>
            this.timers.nextFrame(() => {
                if (this.destroyed || this.current !== slide) {
                    return;
                }
                this.layers = this.layers.map(layer => (layer.slide === slide ? { ...layer, phase: 'active' } : layer));
                this.emit();
                this.transitionTimer = this.timers.setTimeout(
                    () => this.finishTransition(true),
                    this.options.transitionMs + 50,
                );
            }),
        );
    }

    /**
     * The transition is over: what left the screen gives its memory back, and the next slide is loaded.
     *
     * @param goOn - start the time of the slide and load the next one
     */
    private finishTransition(goOn: boolean): void {
        if (this.transitionTimer && this.transitionTimer !== true) {
            this.timers.clearTimeout(this.transitionTimer);
        }
        this.transitionTimer = null;

        const leaving = this.layers.filter(layer => layer.phase === 'leave');
        if (leaving.length) {
            leaving.forEach(layer => this.releaseSlide(layer.slide));
            this.layers = this.layers
                .filter(layer => layer.phase !== 'leave')
                .map(layer => (layer.phase === 'enter' ? { ...layer, phase: 'active' } : layer));
            this.emit();
        }
        if (goOn) {
            this.scheduleAdvance();
            this.preloadNext();
        }
    }
}
