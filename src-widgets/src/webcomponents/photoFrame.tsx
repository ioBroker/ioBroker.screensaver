/**
 * `<iob-screensaver-photo-frame>`: the photo frame of the vis-2 widget as a web component, for devices, Aura and
 * every other host of web components. The same slideshow, the same settings - only that the host draws the tile
 * around it, so there is no card of its own.
 */
import type React from 'react';

import type { WebComponentSettings } from '@iobroker/web-components';
import { defineWebComponent } from '@iobroker/web-components/element';

import SlideShow, { type SlideShowCommand } from '../components/SlideShow';
import { frameOids, readFrameConfig } from '../lib/config';
import type { ProjectLocation } from '../lib/useImageList';
import { FRAME_TAG } from './constants';
import { ReactWebComponent } from './element';

class PhotoFrameElement extends ReactWebComponent {
    /** The time of the last update of each button state seen */
    readonly #controlTs = new Map<string, number>();

    #command: SlideShowCommand | null = null;

    #commandSeq = 0;

    protected getStateIds(settings: WebComponentSettings): string[] {
        const config = readFrameConfig(settings);
        return [...frameOids(config), config.nextOid, config.prevOid];
    }

    /**
     * A button state for next or previous was written: a newer update than the one seen before, whatever its value
     * (except `false` and `0`). The first value is no press - it is only what the state holds. As in the widget.
     *
     * @param nextOid - the state for the next picture
     * @param prevOid - the state for the previous picture
     */
    #checkButtons(nextOid: string, prevOid: string): void {
        const buttons: [string, SlideShowCommand['kind']][] = [
            [nextOid, 'next'],
            [prevOid, 'prev'],
        ];
        for (const [oid, kind] of buttons) {
            const state = oid ? this.states[oid] : null;
            if (!state) {
                continue;
            }
            const before = this.#controlTs.get(oid);
            this.#controlTs.set(oid, state.ts);
            if (before !== undefined && state.ts > before && state.val !== false && state.val !== 0) {
                this.#command = { kind, seq: ++this.#commandSeq };
            }
        }
    }

    protected renderContent(project: ProjectLocation): React.ReactNode {
        const config = readFrameConfig(this.settings);
        this.#checkButtons(config.nextOid, config.prevOid);

        const values: Record<string, unknown> = {};
        const units: Record<string, string> = {};
        for (const oid of frameOids(config)) {
            values[oid] = this.states[oid]?.val;
            const unit = (this.objects[oid]?.common as ioBroker.StateCommon | undefined)?.unit;
            if (unit) {
                units[oid] = unit.trim();
            }
        }
        const pauseOid = config.pauseOid;

        return (
            <SlideShow
                config={config}
                socket={this.connection}
                project={project}
                values={values}
                units={units}
                command={this.#command}
                onWritePause={pauseOid ? paused => void this.setState(pauseOid, paused) : undefined}
                editMode={this.editMode}
                mutedColor={this.theme.textSecondary}
            />
        );
    }
}

defineWebComponent(FRAME_TAG, PhotoFrameElement);
