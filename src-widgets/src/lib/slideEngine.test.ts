/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SlideEngine, isPortrait, shuffledOrder, type EngineSnapshot, type EngineTimers } from './slideEngine';
import type { PreparedPhoto, TargetSize } from './photoLoader';
import type { PhotoRef } from './sources';

/** Timers that run only when the test says so: a whole slideshow in a few milliseconds */
class FakeClock implements EngineTimers {
    now = 0;

    private seq = 0;

    private readonly timers = new Map<number, { at: number; fn: () => void }>();

    private frames: (() => void)[] = [];

    setTimeout = (fn: () => void, ms: number): unknown => {
        const id = ++this.seq;
        this.timers.set(id, { at: this.now + ms, fn });
        return id;
    };

    clearTimeout = (handle: unknown): void => {
        this.timers.delete(handle as number);
    };

    nextFrame = (fn: () => void): void => {
        this.frames.push(fn);
    };

    /** Let the promises of the loader resolve and the browser draw */
    async settle(): Promise<void> {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setImmediate(resolve));
            const frames = this.frames.splice(0);
            frames.forEach(fn => fn());
        }
    }

    /** Let time pass, running every timer that falls into it */
    async tick(ms: number): Promise<void> {
        const end = this.now + ms;
        for (;;) {
            await this.settle();
            let next: [number, { at: number; fn: () => void }] | undefined;
            for (const entry of this.timers) {
                if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) {
                    next = entry;
                }
            }
            if (!next) {
                break;
            }
            this.timers.delete(next[0]);
            this.now = next[1].at;
            next[1].fn();
        }
        this.now = end;
        await this.settle();
    }
}

interface Fixture {
    clock: FakeClock;
    engine: SlideEngine;
    snap: () => EngineSnapshot;
    /** What is on the screen: the URLs of the slide that does not leave */
    shown: () => string[];
    /** Every load, in order */
    loads: string[];
    /** Photos loaded and not released */
    alive: () => number;
    wraps: () => number;
}

const TARGET: TargetSize = { width: 1280, height: 800 };

function refs(...urls: string[]): PhotoRef[] {
    return urls.map(url => ({ key: url, url }));
}

/**
 * A slideshow with a loader that knows the pictures by their names: `p…` are portrait, everything else landscape,
 * `bad…` fails
 */
function setup(options: { random?: () => number } = {}): Fixture {
    const clock = new FakeClock();
    let snapshot: EngineSnapshot | null = null;
    const loads: string[] = [];
    let alive = 0;
    let wraps = 0;
    const loader = async (ref: PhotoRef, _target: TargetSize, signal: AbortSignal): Promise<PreparedPhoto> => {
        await Promise.resolve();
        loads.push(ref.url);
        if (signal.aborted) {
            throw new Error('aborted');
        }
        if (ref.url.startsWith('bad')) {
            throw new Error('HTTP 404');
        }
        alive++;
        let released = false;
        const portrait = ref.url.startsWith('p');
        return {
            ref,
            src: ref.url,
            backdrop: null,
            width: portrait ? 3000 : 4000,
            height: portrait ? 4000 : 3000,
            meta: {},
            release: () => {
                assert.equal(released, false, `${ref.url} released twice`);
                released = true;
                alive--;
            },
        };
    };
    const engine = new SlideEngine(loader, s => (snapshot = s), clock, options.random);
    engine.update({ onWrap: () => wraps++ });
    const snap = (): EngineSnapshot => snapshot || engine.snapshot();
    return {
        clock,
        engine,
        snap,
        shown: () => {
            const layer = snap().layers.filter(l => l.phase !== 'leave').pop();
            return layer ? layer.slide.photos.map(p => p.ref.url) : [];
        },
        loads,
        alive: () => alive,
        wraps: () => wraps,
    };
}

const SHOW = { intervalMs: 10000, transitionMs: 1000, transition: 'fade' as const, target: TARGET, landscape: true };

/** Interval, transition and the frames around it: one slide further */
const STEP = 10000 + 1000 + 50;

void describe('isPortrait and shuffledOrder', () => {
    void it('tells portrait from landscape and square', () => {
        assert.equal(isPortrait({ width: 3000, height: 4000 }), true);
        assert.equal(isPortrait({ width: 4000, height: 3000 }), false);
        assert.equal(isPortrait({ width: 1000, height: 1020 }), false);
    });

    void it('shuffles every place exactly once and never starts with the one to avoid', () => {
        for (let round = 0; round < 50; round++) {
            const order = shuffledOrder(5, 2);
            assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4]);
            assert.notEqual(order[0], 2);
        }
        assert.deepEqual(shuffledOrder(1, 0), [0]);
        assert.deepEqual(shuffledOrder(0), []);
    });
});

void describe('SlideEngine', () => {
    void it('waits for the size of the frame before it loads anything', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b'), ...SHOW, target: null });
        await f.clock.settle();
        assert.equal(f.loads.length, 0);
        assert.equal(f.snap().status, 'loading');

        f.engine.update({ target: TARGET });
        await f.clock.settle();
        assert.equal(f.snap().status, 'showing');
        assert.deepEqual(f.shown(), ['a']);
    });

    void it('says so when there is nothing to show', async () => {
        const f = setup();
        f.engine.update({ photos: [], ...SHOW });
        await f.clock.settle();
        assert.equal(f.snap().status, 'empty');
    });

    void it('goes through the pictures in order and starts over', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b', 'c'), ...SHOW });
        await f.clock.settle();
        const seen = [f.shown()[0]];
        for (let i = 0; i < 4; i++) {
            await f.clock.tick(STEP);
            seen.push(f.shown()[0]);
        }
        assert.deepEqual(seen, ['a', 'b', 'c', 'a', 'b']);
        assert.equal(f.wraps(), 1);
        assert.equal(f.snap().position, 1);
        assert.equal(f.snap().total, 3);
    });

    void it('fades: the new slide enters over the old one, which is gone after the transition', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b'), ...SHOW });
        await f.clock.settle();
        // the time a picture stands starts when its transition is over
        await f.clock.tick(STEP);
        const during = f.snap().layers;
        assert.equal(during.length, 2);
        assert.equal(during[0].phase, 'leave');
        assert.equal(during[1].phase, 'active');
        await f.clock.tick(1100);
        assert.equal(f.snap().layers.length, 1);
        assert.deepEqual(f.shown(), ['b']);
    });

    void it('keeps at most three pictures in memory and gives all back at the end', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b', 'c', 'd', 'e'), ...SHOW });
        await f.clock.settle();
        let most = f.alive();
        for (let ms = 0; ms < STEP * 12; ms += 250) {
            await f.clock.tick(250);
            most = Math.max(most, f.alive());
        }
        assert.ok(most <= 3, `${most} pictures in memory`);
        f.engine.destroy();
        assert.equal(f.alive(), 0);
    });

    void it('without a transition shows one layer only', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b'), ...SHOW, transition: 'none', transitionMs: 0 });
        await f.clock.settle();
        await f.clock.tick(10000);
        assert.equal(f.snap().layers.length, 1);
        assert.deepEqual(f.shown(), ['b']);
        assert.equal(f.alive() <= 2, true);
    });

    void it('puts two portrait pictures side by side in a wide frame', async () => {
        const f = setup();
        f.engine.update({ photos: refs('p1', 'p2', 'l3'), ...SHOW });
        await f.clock.settle();
        assert.deepEqual(f.shown(), ['p1', 'p2']);
        assert.equal(f.snap().layers[0].slide.len, 2);
        await f.clock.tick(STEP);
        assert.deepEqual(f.shown(), ['l3']);
        assert.equal(f.snap().position, 2);
    });

    void it('does not pair in a narrow frame, or when switched off', async () => {
        const narrow = setup();
        narrow.engine.update({ photos: refs('p1', 'p2', 'l3'), ...SHOW, landscape: false });
        await narrow.clock.settle();
        assert.deepEqual(narrow.shown(), ['p1']);

        const off = setup();
        off.engine.update({ photos: refs('p1', 'p2', 'l3'), ...SHOW, pairPortraits: false });
        await off.clock.settle();
        assert.deepEqual(off.shown(), ['p1']);
    });

    void it('a portrait before a landscape stays alone, and the landscape is not loaded twice', async () => {
        const f = setup();
        f.engine.update({ photos: refs('p1', 'l2', 'l3'), ...SHOW });
        await f.clock.settle();
        assert.deepEqual(f.shown(), ['p1']);
        await f.clock.tick(STEP);
        assert.deepEqual(f.shown(), ['l2']);
        assert.equal(f.loads.filter(url => url === 'l2').length, 1);
    });

    void it('skips a picture that does not load', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'bad', 'c'), ...SHOW });
        await f.clock.settle();
        await f.clock.tick(STEP);
        assert.deepEqual(f.shown(), ['c']);
        assert.equal(f.snap().status, 'showing');
    });

    void it('reports an error when nothing loads, and tries again later', async () => {
        const f = setup();
        f.engine.update({ photos: refs('bad1', 'bad2'), ...SHOW });
        await f.clock.settle();
        assert.equal(f.snap().status, 'error');
        const tries = f.loads.length;
        await f.clock.tick(29000);
        assert.equal(f.loads.length, tries);
        await f.clock.tick(2000);
        assert.ok(f.loads.length > tries);
    });

    void it('stands still while paused, and still goes on by hand', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b', 'c'), ...SHOW, paused: true });
        await f.clock.settle();
        await f.clock.tick(STEP * 3);
        assert.deepEqual(f.shown(), ['a']);
        assert.equal(f.snap().paused, true);

        f.engine.next();
        await f.clock.tick(1100);
        assert.deepEqual(f.shown(), ['b']);
        await f.clock.tick(STEP * 3);
        assert.deepEqual(f.shown(), ['b']);

        f.engine.setPaused(false);
        await f.clock.tick(STEP);
        assert.deepEqual(f.shown(), ['c']);
    });

    void it('goes back with prev, a single picture and backwards', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b', 'c'), ...SHOW });
        await f.clock.settle();
        f.engine.prev();
        await f.clock.settle();
        assert.deepEqual(f.shown(), ['c']);
        assert.equal(f.snap().layers[f.snap().layers.length - 1].dir, -1);
        f.engine.prev();
        await f.clock.tick(1100);
        assert.deepEqual(f.shown(), ['b']);
    });

    void it('keeps the picture on the screen when the list changes, and shows a new one next in random order', async () => {
        let n = 0;
        // a fixed sequence instead of chance
        const f = setup({ random: () => [0.1, 0.7, 0.4, 0.9, 0.3][n++ % 5] });
        f.engine.update({ photos: refs('a', 'b', 'c', 'd'), ...SHOW, order: 'random' });
        await f.clock.settle();
        const first = f.shown()[0];

        f.engine.update({ photos: refs('a', 'b', 'c', 'd', 'new') });
        await f.clock.settle();
        assert.deepEqual(f.shown(), [first]);
        await f.clock.tick(STEP);
        assert.deepEqual(f.shown(), ['new']);
        assert.equal(f.snap().total, 5);
    });

    void it('in order a new picture takes its place by name and the one on the screen stays', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'c'), ...SHOW });
        await f.clock.settle();
        f.engine.update({ photos: refs('a', 'b', 'c') });
        await f.clock.settle();
        assert.deepEqual(f.shown(), ['a']);
        await f.clock.tick(STEP);
        assert.deepEqual(f.shown(), ['b']);
    });

    void it('gives everything back when the list becomes empty', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b'), ...SHOW });
        await f.clock.tick(STEP);
        f.engine.update({ photos: [] });
        await f.clock.settle();
        assert.equal(f.snap().status, 'empty');
        assert.equal(f.snap().layers.length, 0);
        assert.equal(f.alive(), 0);
    });

    void it('goes on after the picture where it stopped last time', async () => {
        const f = setup();
        f.engine.update({ photos: refs('a', 'b', 'c'), ...SHOW, startAfterKey: 'b' });
        await f.clock.settle();
        assert.deepEqual(f.shown(), ['c']);
    });

    void it('reports each slide that comes on the screen', async () => {
        const f = setup();
        const shown: string[] = [];
        f.engine.update({
            photos: refs('a', 'b'),
            ...SHOW,
            onShow: slide => shown.push(slide.photos[0].ref.url),
        });
        await f.clock.tick(STEP);
        assert.deepEqual(shown, ['a', 'b']);
        assert.equal(f.engine.currentKey, 'b');
    });
});
