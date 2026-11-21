/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cleanOid, frameOids, hasWeather, readBool, readFrameConfig, readNumber, readScreensaverConfig } from './config';
import { brightnessOf, collectCandidates, delayOf, isEnabled, isOff, pickCandidate } from './screensaver';
import { textToKind, weatherIcon, wmoToKind } from './weather';
import { mergeFrame, readWidgetCss } from './widgetCss';

void describe('readFrameConfig', () => {
    void it('gives the defaults of the requirement for an empty widget', () => {
        const config = readFrameConfig({});
        assert.equal(config.source, 'folder');
        assert.equal(config.interval, 10);
        assert.equal(config.order, 'sequential');
        assert.equal(config.transition, 'fade');
        assert.equal(config.transitionTime, 1.5);
        assert.equal(config.kenBurns, true);
        assert.equal(config.fit, 'cover');
        assert.equal(config.captionPosition, 'bottomLeft');
        assert.equal(config.showClock, false);
        assert.equal(config.interactive, true);
        assert.equal(config.noCard, false);
    });

    void it('reads what the editor stores: strings, unset IDs, limits', () => {
        const config = readFrameConfig({
            interval: '1',
            transitionTime: '99',
            kenBurns: 'false',
            source: 'state',
            listOid: 'nothing_selected',
            pauseOid: ' 0_userdata.0.pause ',
            order: 'shuffle',
            weatherTempOid: 'weather.0.temp',
        });
        assert.equal(config.interval, 2);
        assert.equal(config.transitionTime, 10);
        assert.equal(config.kenBurns, false);
        assert.equal(config.source, 'state');
        assert.equal(config.listOid, '');
        assert.equal(config.pauseOid, '0_userdata.0.pause');
        assert.equal(config.order, 'sequential');
        assert.equal(hasWeather(config.weather), true);
        assert.deepEqual(frameOids(config), ['0_userdata.0.pause', 'weather.0.temp']);
    });

    void it('needs the list state only for the state source', () => {
        assert.deepEqual(frameOids(readFrameConfig({ source: 'folder', listOid: 'a.0.list', albumOid: 'a.0.album' })), ['a.0.album']);
        assert.deepEqual(frameOids(readFrameConfig({ source: 'state', listOid: 'a.0.list', albumOid: 'a.0.album' })), ['a.0.list']);
    });

    void it('has small helpers that never throw', () => {
        assert.equal(cleanOid(undefined), '');
        assert.equal(cleanOid(5), '');
        assert.equal(readBool('', true), true);
        assert.equal(readBool('1', false), true);
        assert.equal(readBool(0, true), false);
        assert.equal(readNumber('abc', 3, 0, 10), 3);
        assert.equal(readNumber(-5, 3, 0, 10), 0);
    });
});

void describe('screensaver', () => {
    void it('has a clock, no card and no navigation by default', () => {
        const config = readScreensaverConfig({ interactive: true, noCard: false, afterView: ['home'] });
        assert.equal(config.showClock, true);
        assert.equal(config.noCard, true);
        assert.equal(config.interactive, false);
        assert.equal(config.timeout, 5);
        assert.equal(config.scope, 'project');
        assert.equal(config.afterView, 'home');
        assert.equal(readScreensaverConfig({ showClock: false }).showClock, false);
    });

    const widgets = [
        { view: 'home', id: 'w1', tpl: 'tplScreensaverScreensaver', data: { timeout: 5 } },
        { view: 'camera', id: 'w2', tpl: 'tplScreensaverScreensaver', data: { timeout: 0, scope: 'view' } },
        { view: 'kitchen', id: 'w3', tpl: 'tplScreensaverScreensaver', data: { timeout: 1, scope: 'view' } },
        { view: 'home', id: 'w4', tpl: 'tplScreensaverPhotoFrame', data: {} },
    ];
    const candidates = collectCandidates(widgets, 'tplScreensaverScreensaver');

    void it('takes the one of the view before the one of the project', () => {
        assert.equal(candidates.length, 3);
        assert.equal(pickCandidate(candidates, 'home')?.id, 'w1');
        assert.equal(pickCandidate(candidates, 'other')?.id, 'w1');
        assert.equal(pickCandidate(candidates, 'kitchen')?.id, 'w3');
        assert.equal(pickCandidate(candidates, 'camera')?.id, 'w2');
        assert.equal(pickCandidate(candidates.slice(1), 'other'), null);
    });

    void it('waits the minutes of its view, and never on a view that says 0', () => {
        assert.equal(delayOf(pickCandidate(candidates, 'home'), {}), 5 * 60000);
        assert.equal(delayOf(pickCandidate(candidates, 'kitchen'), {}), 60000);
        assert.equal(delayOf(pickCandidate(candidates, 'camera'), {}), 0);
        assert.equal(delayOf(null, {}), 0);
    });

    void it('is switched off by its state, e.g. at night', () => {
        const config = readScreensaverConfig({ enabledOid: 'a.0.on' });
        assert.equal(isEnabled(config, {}), true);
        assert.equal(isEnabled(config, { 'a.0.on': true }), true);
        assert.equal(isEnabled(config, { 'a.0.on': false }), false);
        assert.equal(isEnabled(config, { 'a.0.on': 'off' }), false);
        assert.equal(delayOf({ id: 'x', view: 'v', config }, { 'a.0.on': 0 }), 0);
        assert.equal(isOff('0'), true);
        assert.equal(isOff(null), false);
    });

    void it('dims by a switch to its level, or by a number in percent', () => {
        const config = readScreensaverConfig({ dimOid: 'a.0.dim', dimLevel: 20 });
        assert.equal(brightnessOf(config, { 'a.0.dim': false }), 1);
        assert.equal(brightnessOf(config, { 'a.0.dim': true }), 0.2);
        assert.equal(brightnessOf(config, { 'a.0.dim': 55 }), 0.55);
        assert.equal(brightnessOf(config, { 'a.0.dim': '150' }), 1);
        assert.equal(brightnessOf(readScreensaverConfig({}), { 'a.0.dim': true }), 1);
    });
});

void describe('weather', () => {
    void it('reads WMO codes', () => {
        assert.equal(wmoToKind(0), 'clear');
        assert.equal(wmoToKind(2), 'partly');
        assert.equal(wmoToKind(3), 'cloudy');
        assert.equal(wmoToKind(45), 'fog');
        assert.equal(wmoToKind(63), 'rain');
        assert.equal(wmoToKind(73), 'snow');
        assert.equal(wmoToKind(95), 'thunder');
        assert.equal(wmoToKind(-1), null);
    });

    void it('reads the texts of weather adapters in several languages', () => {
        assert.equal(textToKind('Schneefall'), 'snow');
        assert.equal(textToKind('Leichter Regen'), 'rain');
        assert.equal(textToKind('Overcast clouds'), 'cloudy');
        assert.equal(textToKind('Ясно'), 'clear');
        assert.equal(textToKind('Gewitter'), 'thunder');
        assert.equal(textToKind('xyz'), null);
    });

    void it('takes a code, a picture or a text, and falls back on the text state', () => {
        assert.deepEqual(weatherIcon(71, ''), { kind: 'snow' });
        assert.deepEqual(weatherIcon('3', ''), { kind: 'cloudy' });
        assert.deepEqual(weatherIcon('https://example.com/icons/04d.png', ''), { url: 'https://example.com/icons/04d.png' });
        assert.deepEqual(weatherIcon('', 'Schneefall'), { kind: 'snow' });
        assert.equal(weatherIcon(null, null), null);
    });
});

void describe('widget CSS on the card', () => {
    void it('takes the frame settings off the widget and gives them to the card', () => {
        const css = readWidgetCss({ 'background-color': 'red', 'border-radius': '20', left: '10px', 'box-shadow': '' });
        assert.deepEqual(css.frame, { backgroundColor: 'red', borderRadius: 20 });
    });

    void it('lets a short form replace the long forms of the card', () => {
        const merged = mergeFrame(
            { backgroundColor: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: '#ddd', borderRadius: 12 },
            { border: '2px dashed blue', background: 'black' },
        );
        assert.deepEqual(merged, { borderRadius: 12, border: '2px dashed blue', background: 'black' });
    });
});
