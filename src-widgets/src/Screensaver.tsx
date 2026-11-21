import React from 'react';

import type { RxRenderWidgetProps, RxWidgetInfo, VisRxWidgetState } from '@iobroker/types-vis-2';

import Generic from './Generic';
import ScreensaverRunner from './components/ScreensaverRunner';
import SlideShow from './components/SlideShow';
import { renderPreviewField } from './components/PreviewField';
import { captionGroup, displayGroup, infoGroup, sourceGroup } from './lib/attributes';
import { cardStyle, CARD_RADIUS } from './lib/card';
import { frameOids, readScreensaverConfig } from './lib/config';
import { t } from './lib/i18n';
import { SCREENSAVER_PREVIEW, SCREENSAVER_PREVIEW_LARGE } from './lib/previews';
import { currentView } from './lib/screensaver';
import type { ProjectLocation } from './lib/useImageList';

type ScreensaverRxData = Record<string, any>;

/** The type of this widget, by which the background service finds it */
export const SCREENSAVER_TPL = 'tplScreensaverScreensaver';

/** Does the running vis-2 render background services? Only then it can lie over every view */
function servicesSupported(): boolean {
    const features = (window.visRxWidget as unknown as { FEATURES?: string[] } | undefined)?.FEATURES;
    return Array.isArray(features) && features.includes('services');
}

/**
 * The screensaver: put it on any view of a project, and after some minutes without input the photos lie over
 * whatever view is open. A touch ends it without switching anything under it.
 *
 * The widget itself only carries the settings. In the editor it shows what the screensaver will look like; in
 * the runtime it takes no place at all - the background service of this set (`ScreensaverService`) reads its
 * settings and runs the screensaver over every view. A vis-2 without background services gets the screensaver
 * from the widget itself, on the view it is on.
 */
class Screensaver extends Generic<ScreensaverRxData, VisRxWidgetState> {
    static getWidgetInfo(): RxWidgetInfo {
        return {
            id: SCREENSAVER_TPL,
            visSet: 'screensaver',
            visName: 'Screensaver',
            visWidgetLabel: 'screensaver',
            visHelp: 'help_screensaver',
            visPrev: SCREENSAVER_PREVIEW,
            visPrevLarge: SCREENSAVER_PREVIEW_LARGE,
            visOrder: 2,
            visAttrs: [
                {
                    name: 'common',
                    fields: [
                        {
                            name: 'help',
                            type: 'help',
                            text: 'screensaver_hint',
                        },
                        {
                            name: 'preview',
                            label: 'preview_label',
                            type: 'custom',
                            component: renderPreviewField,
                            noBinding: true,
                        },
                        {
                            name: 'timeout',
                            label: 'timeout',
                            tooltip: 'timeout_tooltip',
                            type: 'number',
                            default: 5,
                            min: 0,
                            max: 1440,
                            step: 0.5,
                            noBinding: true,
                        },
                        {
                            name: 'scope',
                            label: 'scope',
                            tooltip: 'scope_tooltip',
                            type: 'select',
                            default: 'project',
                            options: [
                                { value: 'project', label: 'scope_project' },
                                { value: 'view', label: 'scope_view' },
                            ],
                            noBinding: true,
                        },
                        {
                            name: 'afterView',
                            label: 'after_view',
                            tooltip: 'after_view_tooltip',
                            type: 'select-views',
                            multiple: false,
                            noBinding: true,
                        },
                        {
                            name: 'endOnMouseMove',
                            label: 'end_on_mouse_move',
                            tooltip: 'end_on_mouse_move_tooltip',
                            type: 'checkbox',
                            default: true,
                            noBinding: true,
                        },
                        { name: 'stateDelimiter', type: 'delimiter' },
                        {
                            name: 'enabledOid',
                            label: 'enabled_oid',
                            tooltip: 'enabled_oid_tooltip',
                            type: 'id',
                            noInit: true,
                            noBinding: true,
                        },
                        {
                            name: 'dimOid',
                            label: 'dim_oid',
                            tooltip: 'dim_oid_tooltip',
                            type: 'id',
                            noInit: true,
                            noBinding: true,
                        },
                        {
                            name: 'dimLevel',
                            label: 'dim_level',
                            tooltip: 'dim_level_tooltip',
                            type: 'slider',
                            min: 0,
                            max: 100,
                            step: 5,
                            default: 30,
                            noBinding: true,
                            hidden: (data: Record<string, any>) => !data.dimOid || data.dimOid === 'nothing_selected',
                        },
                    ],
                },
                sourceGroup({ noBinding: true }),
                displayGroup({ noBinding: true }),
                captionGroup({ noBinding: true }),
                infoGroup({ noBinding: true, clockByDefault: true }),
            ],
            visDefaultStyle: {
                width: 320,
                height: 180,
                position: 'relative',
            },
            // it is only seen in the editor: a small tile is enough to find and select it
            visDefaultGrid: { columns: 6, rows: 3, minColumns: 3, minRows: 2 },
            visResizable: true,
        };
    }

    getWidgetInfo(): RxWidgetInfo {
        return Screensaver.getWidgetInfo();
    }

    private project(): ProjectLocation {
        const { adapterName, instance, projectName } = this.props.context;
        const folder = `${adapterName}.${instance}/${projectName}`;
        return { url: `../${folder}`, folder };
    }

    render(): React.JSX.Element | null {
        if (this.state.editMode) {
            return super.render();
        }
        // the runtime: nothing on the view, not even an empty cell of the grid
        if (servicesSupported()) {
            return null;
        }
        // an older vis-2: the screensaver runs from here, while this view is open
        return (
            <ScreensaverRunner
                socket={this.props.context.socket}
                project={this.project()}
                candidates={[{ id: this.props.id, view: this.props.view, config: readScreensaverConfig(this.state.rxData) }]}
                getView={currentView}
                changeView={view => this.props.context.changeView(view)}
                watch
            />
        );
    }

    renderWidgetBody(props: RxRenderWidgetProps): React.JSX.Element | React.JSX.Element[] | null {
        super.renderWidgetBody(props);

        const config = readScreensaverConfig(this.state.rxData);
        const theme = this.props.context.theme;
        const values: Record<string, unknown> = {};
        for (const oid of frameOids(config)) {
            values[oid] = this.state.values[`${oid}.val`];
        }

        const minutes = config.timeout;
        const when = minutes > 0 ? t('after_minutes', minutes.toLocaleString(this.props.context.lang)) : t('never');
        const scope = config.scope === 'view' ? t('scope_view') : t('scope_project');

        return (
            <div
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    ...cardStyle(theme),
                }}
            >
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: CARD_RADIUS - 1 }}>
                    <SlideShow
                        config={config}
                        socket={this.props.context.socket}
                        project={this.project()}
                        values={values}
                        units={{}}
                        editMode
                        dark
                    />
                    <div
                        style={{
                            position: 'absolute',
                            left: 8,
                            top: 8,
                            zIndex: 10,
                            maxWidth: 'calc(100% - 16px)',
                            padding: '4px 10px',
                            borderRadius: 14,
                            background: 'rgba(0, 0, 0, 0.55)',
                            color: '#fff',
                            fontSize: 12,
                            lineHeight: 1.4,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pointerEvents: 'none',
                        }}
                    >
                        {`${t('screensaver')} · ${when} · ${scope}`}
                    </div>
                </div>
            </div>
        );
    }
}

export default Screensaver;
