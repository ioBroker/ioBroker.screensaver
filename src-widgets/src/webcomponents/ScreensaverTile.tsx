import React from 'react';

import type { Connection } from '@iobroker/gui-components';

import ScreensaverRunner from '../components/ScreensaverRunner';
import { TEXT_SHADOW } from '../components/styles';
import type { ScreensaverConfig } from '../lib/config';
import { getLanguage, t } from '../lib/i18n';
import { SCREENSAVER_PREVIEW_LARGE } from '../lib/previews';
import type { ScreensaverCandidate } from '../lib/screensaver';
import type { ProjectLocation } from '../lib/useImageList';

/** The drawing of the palette as a picture: a landscape with the clock and the weather card at the right */
const PREVIEW_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    SCREENSAVER_PREVIEW_LARGE.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
)}`;

/** A web component has no views: the screensaver is the one of the page */
const noView = (): string => '';

export interface ScreensaverTileProps {
    /** The screensaver as the only candidate; the same object as long as the settings are the same */
    candidates: ScreensaverCandidate[];
    config: ScreensaverConfig;
    socket: Connection | null;
    project: ProjectLocation;
    editMode: boolean;
    /** The on/off state does not say off */
    enabled: boolean;
}

/**
 * The tile of the screensaver in a host of web components, and the screensaver itself.
 *
 * The tile shows what it is and when it starts; a tap starts it at once. The screensaver watches the input of the
 * whole page, as the background service does in vis-2, and lies over the page - not only over the tile. In edit
 * mode it never starts: the user is arranging the page.
 *
 * @param props - the settings and what the host gives
 */
export default function ScreensaverTile(props: ScreensaverTileProps): React.JSX.Element {
    // counts the starts by a tap; 0: the screensaver only starts after the waiting time
    const [manual, setManual] = React.useState(0);
    const { config, socket, editMode } = props;

    let status: string;
    if (!props.enabled) {
        status = t('switched_off');
    } else if (!config.timeout) {
        status = t('never');
    } else {
        status = t('after_minutes', config.timeout.toLocaleString(getLanguage()));
    }

    const runner =
        editMode || !socket ? null : manual ? (
            // started by a tap: the watching one is not there meanwhile, so that never two slideshows run
            <ScreensaverRunner
                key={manual}
                socket={socket}
                project={props.project}
                candidates={props.candidates}
                getView={noView}
                watch={false}
                startShown
                onIdle={() => setManual(0)}
            />
        ) : (
            <ScreensaverRunner
                socket={socket}
                project={props.project}
                candidates={props.candidates}
                getView={noView}
                watch
            />
        );

    return (
        <div
            onClick={
                editMode
                    ? undefined
                    : e => {
                          // React passes events of the overlay (a portal in the body) up to the tile as well
                          if (e.currentTarget.contains(e.target as Node)) {
                              setManual(seq => seq + 1);
                          }
                      }
            }
            title={editMode ? undefined : t('tap_to_start')}
            style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                cursor: editMode ? undefined : 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
            }}
        >
            <img
                src={PREVIEW_URL}
                alt=""
                draggable={false}
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    // the clock and the weather card are at the right of the drawing
                    objectPosition: '100% 50%',
                    opacity: props.enabled ? 1 : 0.45,
                    filter: props.enabled ? undefined : 'grayscale(1)',
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: '14cqmin 7cqmin 6cqmin',
                    background: 'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.6))',
                    color: '#fff',
                    textShadow: TEXT_SHADOW,
                    lineHeight: 1.25,
                }}
            >
                <div style={{ fontWeight: 600, fontSize: 'clamp(12px, 10cqmin, 22px)' }}>{t('screensaver')}</div>
                <div style={{ fontSize: 'clamp(10px, 8cqmin, 16px)', opacity: 0.92 }}>{status}</div>
                {editMode ? null : (
                    <div style={{ fontSize: 'clamp(9px, 6.5cqmin, 13px)', opacity: 0.75, marginTop: '1cqmin' }}>
                        {t('tap_to_start')}
                    </div>
                )}
            </div>
            {runner}
        </div>
    );
}
