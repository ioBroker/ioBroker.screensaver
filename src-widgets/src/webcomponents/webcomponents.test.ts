/// <reference types="node" />
import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { checkManifest, getDefaultSettings, getSettingTypes, toSettings } from '@iobroker/web-components';

import { readFrameConfig, readScreensaverConfig } from '../lib/config';
import { FRAME_TAG, SCREENSAVER_TAG } from './constants';
import { findFilesUrl, serverBase } from './files';
import { LANGUAGES, buildFrameManifest, buildIcons, buildManifests, buildScreensaverManifest } from './manifests';

describe('web component manifests', () => {
    it('are valid manifests and name the modules and icons next to them', () => {
        const icons = buildIcons();
        for (const manifest of buildManifests()) {
            assert.equal(checkManifest(manifest), null, manifest.tag);
            assert.equal(manifest.module, `${manifest.tag}.js`);
            assert.ok(manifest.icon && icons[manifest.icon], `icon of ${manifest.tag}`);
            assert.ok(icons[manifest.icon].includes('xmlns="http://www.w3.org/2000/svg"'));
        }
        assert.deepEqual(
            buildManifests().map(manifest => manifest.tag),
            [FRAME_TAG, SCREENSAVER_TAG],
        );
    });

    it('have every word in every language', () => {
        const name = buildFrameManifest().name as Record<string, string>;
        assert.deepEqual(Object.keys(name).sort(), [...LANGUAGES].sort());
        assert.equal(name.de, 'Bilderrahmen');
    });

    it('give a new frame the defaults of the vis-2 widget', () => {
        const settings = getDefaultSettings(buildFrameManifest());
        assert.equal(settings.source, 'folder');
        assert.deepEqual(readFrameConfig(settings), readFrameConfig({}));
    });

    it('give a new screensaver the defaults of the vis-2 widget', () => {
        const settings = getDefaultSettings(buildScreensaverManifest());
        assert.equal(settings.timeout, 5);
        assert.equal(settings.showClock, true);
        assert.deepEqual(readScreensaverConfig(settings), readScreensaverConfig({}));
    });

    it('type the values as the config reads them', () => {
        const manifest = buildFrameManifest();
        const settings = toSettings(getSettingTypes(manifest), {
            source: 'list',
            urls: '0_userdata.0/fotos/a.jpg',
            interval: '30',
            kenBurns: 'false',
            weatherTempOid: 'weather.0.temp',
        });
        const config = readFrameConfig(settings);
        assert.equal(config.source, 'list');
        assert.equal(config.interval, 30);
        assert.equal(config.kenBurns, false);
        assert.equal(config.weather.temperature, 'weather.0.temp');
    });
});

describe('file storage of a web component', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    /**
     * A server that delivers the icon at one URL only
     *
     * @param iconUrl - where the icon is
     * @param loginPage - every other URL answers with a login page
     */
    function serve(iconUrl: string, loginPage = false): string[] {
        const asked: string[] = [];
        globalThis.fetch = ((input: string | URL): Promise<Response> => {
            const url = String(input);
            asked.push(url);
            if (url === iconUrl) {
                return Promise.resolve(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
            }
            if (loginPage) {
                return Promise.resolve(new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
            }
            return Promise.resolve(new Response('', { status: 404 }));
        }) as typeof fetch;
        return asked;
    }

    it('finds the server the module came from, with the path of a proxy', () => {
        assert.equal(
            serverBase('http://host:8082/adapter/screensaver/webcomponents/shared-x.js'),
            'http://host:8082/',
        );
        assert.equal(
            serverBase('https://example.com/iob/adapter/screensaver/webcomponents/a.js'),
            'https://example.com/iob/',
        );
        assert.equal(serverBase('http://localhost:5173/src/webcomponents/files.ts'), 'http://localhost:5173/');
    });

    it('takes /<object>/ of web', async () => {
        serve('http://host:8082/screensaver.admin/screensaver.svg');
        assert.equal(await findFilesUrl('http://host:8082/'), 'http://host:8082/');
    });

    it('takes /files/<object>/ of admin', async () => {
        const asked = serve('http://host:8081/files/screensaver.admin/screensaver.svg');
        assert.equal(await findFilesUrl('http://host:8081/'), 'http://host:8081/files/');
        assert.equal(asked.length, 2);
    });

    it('does not take a login page for the icon', async () => {
        serve('https://example.com/iob/files/screensaver.admin/screensaver.svg', true);
        assert.equal(await findFilesUrl('https://example.com/iob/'), 'https://example.com/iob/files/');
    });
});
