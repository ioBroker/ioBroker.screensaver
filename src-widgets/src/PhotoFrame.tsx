import React from 'react';

import type { RxRenderWidgetProps, RxWidgetInfo, VisRxWidgetState } from '@iobroker/types-vis-2';

import Generic from './Generic';
import SlideShow, { type SlideShowCommand } from './components/SlideShow';
import { captionGroup, displayGroup, infoGroup, sourceGroup } from './lib/attributes';
import { frameOids, readFrameConfig, type FrameConfig } from './lib/config';
import { mergeFrame, readWidgetCss } from './lib/widgetCss';
import { cardStyle, CARD_RADIUS } from './lib/card';
import { FRAME_PREVIEW, FRAME_PREVIEW_LARGE } from './lib/previews';
import type { ProjectLocation } from './lib/useImageList';

interface PhotoFrameState extends VisRxWidgetState {
    command: SlideShowCommand | null;
    units: Record<string, string>;
}

type PhotoFrameRxData = Record<string, any>;

/**
 * The photo frame: family photos as a tile in the grid, as a whole page on a wall tablet, or anywhere on a view.
 *
 * It looks like the standard tiles of vis-2 - the paper of the theme, a 12px corner, a line in the colour of the
 * dividers and, in the light theme, a shadow - and takes its size from the cell of the grid. On a page of its
 * own it goes without the card, and the clock and the weather can be put over the pictures.
 */
class PhotoFrame extends Generic<PhotoFrameRxData, PhotoFrameState> {
    /** The time of the last update of each control state, to tell a new press from the value at the start */
    private readonly controlTs = new Map<string, number>();

    private commandSeq = 0;

    private unitsKey = '';

    constructor(props: any) {
        super(props);
        (this.state as PhotoFrameState).command = null;
        (this.state as PhotoFrameState).units = {};
    }

    static getWidgetInfo(): RxWidgetInfo {
        return {
            id: 'tplScreensaverPhotoFrame',
            visSet: 'screensaver',
            visSetLabel: 'set_label',
            visSetColor: '#f59e0b',
            visName: 'PhotoFrame',
            visWidgetLabel: 'photo_frame',
            visHelp: 'help_photo_frame',
            visPrev: FRAME_PREVIEW,
            visPrevLarge: FRAME_PREVIEW_LARGE,
            visOrder: 1,
            visAttrs: [
                {
                    name: 'common',
                    fields: [
                        {
                            name: 'noCard',
                            label: 'without_card',
                            tooltip: 'without_card_tooltip',
                            type: 'checkbox',
                        },
                    ],
                },
                sourceGroup(),
                displayGroup(),
                captionGroup(),
                infoGroup(),
                {
                    name: 'control',
                    label: 'group_control',
                    fields: [
                        {
                            name: 'interactive',
                            label: 'interactive',
                            tooltip: 'interactive_tooltip',
                            type: 'checkbox',
                            default: true,
                        },
                        {
                            name: 'nextOid',
                            label: 'next_oid',
                            tooltip: 'button_oid_tooltip',
                            type: 'id',
                            noInit: true,
                        },
                        {
                            name: 'prevOid',
                            label: 'prev_oid',
                            tooltip: 'button_oid_tooltip',
                            type: 'id',
                            noInit: true,
                        },
                        {
                            name: 'pauseOid',
                            label: 'pause_oid',
                            tooltip: 'pause_oid_tooltip',
                            type: 'id',
                            noInit: true,
                        },
                    ],
                },
            ],
            visDefaultStyle: {
                width: '100%',
                height: 320,
                position: 'relative',
            },
            // a whole section wide and five rows high: about 16:10, the shape of most photos
            visDefaultGrid: { columns: 12, rows: 5, minColumns: 3, minRows: 2 },
            visResizable: true,
        };
    }

    getWidgetInfo(): RxWidgetInfo {
        return PhotoFrame.getWidgetInfo();
    }

    componentDidMount(): void {
        super.componentDidMount();
        this.loadUnits();
    }

    componentDidUpdate(prevProps: any, prevState: any): void {
        super.componentDidUpdate(prevProps, prevState);
        this.loadUnits();
    }

    /** The units of the weather states come from their objects, read once per set of states */
    private loadUnits(): void {
        const weather = readFrameConfig(this.state.rxData).weather;
        const oids = [weather.temperature, weather.wind, weather.humidity, weather.precipitation].filter(Boolean);
        const key = oids.join('\n');
        if (key === this.unitsKey) {
            return;
        }
        this.unitsKey = key;
        const socket = this.props.context.socket;
        void Promise.all(
            oids.map(oid =>
                socket
                    .getObject(oid)
                    .then(obj => [oid, ((obj?.common as ioBroker.StateCommon | undefined)?.unit || '').trim()] as const)
                    .catch(() => [oid, ''] as const),
            ),
        ).then(entries => {
            if (this.unitsKey === key) {
                this.setState({ units: Object.fromEntries(entries) } as Partial<PhotoFrameState> as PhotoFrameState);
            }
        });
    }

    /**
     * A button state for next or previous was written.
     *
     * vis-2 reports the value of a state also when the widget starts, and that is no press. A press is a newer
     * update of the state than the one seen before - whatever was written, so that a button that only ever
     * writes `true` works as well.
     */
    onStateUpdated(id: string, state: Partial<ioBroker.State>): void {
        const config = readFrameConfig(this.state.rxData);
        const kind = id === config.nextOid ? 'next' : id === config.prevOid ? 'prev' : null;
        if (!kind) {
            return;
        }
        const ts = state.ts || Date.now();
        const before = this.controlTs.get(id);
        this.controlTs.set(id, ts);
        if (before === undefined || ts <= before || state.val === false || state.val === 0) {
            return;
        }
        this.setState({ command: { kind, seq: ++this.commandSeq } } as Partial<PhotoFrameState> as PhotoFrameState);
    }

    private project(): ProjectLocation {
        const { adapterName, instance, projectName } = this.props.context;
        const folder = `${adapterName}.${instance}/${projectName}`;
        return { url: `../${folder}`, folder };
    }

    private values(config: FrameConfig): Record<string, unknown> {
        const values: Record<string, unknown> = {};
        for (const oid of frameOids(config)) {
            values[oid] = this.state.values[`${oid}.val`];
        }
        return values;
    }

    renderWidgetBody(props: RxRenderWidgetProps): React.JSX.Element | React.JSX.Element[] | null {
        super.renderWidgetBody(props);

        const config = readFrameConfig(this.state.rxData);
        const theme = this.props.context.theme;

        // What the CSS attributes of the widget paint belongs to the card and not to the outer box, where it would
        // be drawn under the pictures or twice - as the standard widgets of vis-2 do it
        const css = readWidgetCss(this.state.rxStyle);
        Object.keys(css.frame).forEach(name => delete (props.style as Record<string, unknown>)[name]);

        const frame = config.noCard ? mergeFrame({}, css.frame) : mergeFrame(cardStyle(theme), css.frame);
        const radius = config.noCard ? css.frame.borderRadius : (css.frame.borderRadius ?? CARD_RADIUS);

        return (
            <div
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    ...frame,
                }}
            >
                <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: radius }}>
                    <SlideShow
                        config={config}
                        socket={this.props.context.socket}
                        project={this.project()}
                        values={this.values(config)}
                        units={this.state.units}
                        command={this.state.command}
                        onWritePause={paused => config.pauseOid && this.props.context.setValue(config.pauseOid, paused)}
                        editMode={!!this.state.editMode}
                        mutedColor={theme?.palette?.text?.secondary}
                    />
                </div>
            </div>
        );
    }
}

export default PhotoFrame;
