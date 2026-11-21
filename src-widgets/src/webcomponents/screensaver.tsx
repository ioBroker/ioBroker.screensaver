/**
 * `<iob-screensaver>`: the screensaver as a web component, for devices, Aura and every other host of web
 * components. Where vis-2 runs it as the background service of the set, here the tile runs it: after the waiting
 * time without input it lies over the whole page, a touch ends it without switching anything under it.
 */
import type React from 'react';

import type { WebComponentSettings } from '@iobroker/web-components';
import { defineWebComponent } from '@iobroker/web-components/element';

import { readScreensaverConfig, type ScreensaverConfig } from '../lib/config';
import { isEnabled, type ScreensaverCandidate } from '../lib/screensaver';
import type { ProjectLocation } from '../lib/useImageList';
import { SCREENSAVER_TAG } from './constants';
import { ReactWebComponent } from './element';
import ScreensaverTile from './ScreensaverTile';

class ScreensaverElement extends ReactWebComponent {
    /** The settings the config was read from: the host gives a new object only when they change */
    #settingsRead: WebComponentSettings | null = null;

    #config: ScreensaverConfig = readScreensaverConfig({});

    /** One object as long as the settings stay: the screensaver subscribes its states again for a new one */
    #candidates: ScreensaverCandidate[] = [];

    protected getStateIds(settings: WebComponentSettings): string[] {
        return [readScreensaverConfig(settings).enabledOid];
    }

    protected renderContent(project: ProjectLocation): React.ReactNode {
        if (this.settings !== this.#settingsRead) {
            this.#settingsRead = this.settings;
            this.#config = readScreensaverConfig(this.settings);
            this.#candidates = [{ id: SCREENSAVER_TAG, view: '', config: this.#config }];
        }
        const config = this.#config;
        const enabled = isEnabled(config, config.enabledOid ? { [config.enabledOid]: this.states[config.enabledOid]?.val } : {});

        return (
            <ScreensaverTile
                candidates={this.#candidates}
                config={config}
                socket={this.connection}
                project={project}
                editMode={this.editMode}
                enabled={enabled}
            />
        );
    }
}

defineWebComponent(SCREENSAVER_TAG, ScreensaverElement);
