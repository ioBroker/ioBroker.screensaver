import React from 'react';

import type { VisServiceProps } from '@iobroker/types-vis-2';

import ScreensaverRunner from './components/ScreensaverRunner';
import { collectCandidates, currentProject, currentView } from './lib/screensaver';

/** The type of the screensaver widget; not imported from it, so the service does not load the widget class */
const SCREENSAVER_TPL = 'tplScreensaverScreensaver';

/**
 * The background service of this set: vis-2 renders it once, next to the views, for as long as the project is
 * open in the runtime. It finds the screensaver widgets of the project and lies over whichever view is shown
 * when the time without input is up.
 *
 * @param props - the widgets of the set in all views, and what a service gets from vis-2
 */
export default function ScreensaverService(props: VisServiceProps): React.JSX.Element | null {
    const candidates = React.useMemo(
        () => collectCandidates(props.widgets as { view: string; id: string; tpl: string; data: Record<string, unknown> }[], SCREENSAVER_TPL),
        [props.widgets],
    );
    const project = React.useMemo(() => currentProject(), []);

    if (!candidates.length) {
        return null;
    }
    return (
        <ScreensaverRunner
            socket={props.socket}
            project={project}
            candidates={candidates}
            getView={currentView}
            changeView={props.changeView}
            watch
        />
    );
}
