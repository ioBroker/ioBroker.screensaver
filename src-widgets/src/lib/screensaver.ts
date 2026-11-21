/**
 * Which screensaver applies where, and in which state it is.
 *
 * A project may hold several screensaver widgets: one for the whole project, and one for a view that needs
 * another time - or none at all, like the view of a camera that should not disappear behind photos. The widget
 * of the view wins over the one of the project.
 */

import { readScreensaverConfig, type ScreensaverConfig } from './config';

export interface ScreensaverCandidate {
    /** The id of the widget */
    id: string;
    /** The view the widget is on */
    view: string;
    config: ScreensaverConfig;
}

/**
 * The screensavers of a project, from the widgets of the set
 *
 * @param widgets - the widgets of the set in all views, as the background service gets them
 * @param tpl - the type of the screensaver widget
 */
export function collectCandidates(
    widgets: { view: string; id: string; tpl: string; data: Record<string, unknown> }[],
    tpl: string,
): ScreensaverCandidate[] {
    return widgets
        .filter(widget => widget.tpl === tpl)
        .map(widget => ({ id: widget.id, view: widget.view, config: readScreensaverConfig(widget.data) }));
}

/**
 * The screensaver for a view: the one of the view itself, otherwise the one of the project
 *
 * @param candidates - the screensavers of the project
 * @param view - the view that is shown
 */
export function pickCandidate(candidates: ScreensaverCandidate[], view: string): ScreensaverCandidate | null {
    return (
        candidates.find(candidate => candidate.config.scope === 'view' && candidate.view === view) ||
        candidates.find(candidate => candidate.config.scope === 'project') ||
        null
    );
}

/**
 * A state that switches something off: `false`, `0`, `'false'`, `'off'`
 *
 * @param value - the value of the state
 */
export function isOff(value: unknown): boolean {
    return value === false || value === 0 || value === 'false' || value === '0' || value === 'off';
}

/**
 * Whether the screensaver may start: on unless its state says off
 *
 * @param config - the settings
 * @param values - the values of the states
 */
export function isEnabled(config: ScreensaverConfig, values: Record<string, unknown>): boolean {
    return !config.enabledOid || !isOff(values[config.enabledOid]);
}

/**
 * How bright the screensaver is, from 0 to 1.
 *
 * The dim state may be a switch - on dims to the brightness of the settings - or a number, which is the
 * brightness in percent itself, e.g. from a script that follows the light in the room.
 *
 * @param config - the settings
 * @param values - the values of the states
 */
export function brightnessOf(config: ScreensaverConfig, values: Record<string, unknown>): number {
    if (!config.dimOid) {
        return 1;
    }
    const value = values[config.dimOid];
    if (typeof value === 'number' && isFinite(value)) {
        return Math.min(1, Math.max(0, value / 100));
    }
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
        return Math.min(1, Math.max(0, parseFloat(value) / 100));
    }
    if (value === true || value === 'true' || value === 'on') {
        return config.dimLevel / 100;
    }
    return 1;
}

/**
 * After how many milliseconds without input the screensaver starts on this view; 0 is never
 *
 * @param candidate - the screensaver for the view
 * @param values - the values of the states
 */
export function delayOf(candidate: ScreensaverCandidate | null, values: Record<string, unknown>): number {
    if (!candidate || !isEnabled(candidate.config, values)) {
        return 0;
    }
    return Math.round(candidate.config.timeout * 60000);
}

/**
 * The view that is shown in the runtime.
 *
 * The background service is not told which view is open. vis-2 keeps it in `vis.activeView` for the widgets of
 * vis-1, and in the address after `#`.
 */
export function currentView(): string {
    const vis = (window as unknown as { vis?: { activeView?: string } }).vis;
    if (vis?.activeView) {
        return vis.activeView;
    }
    const hash = window.location.hash.replace(/^#/, '').split('/')[0];
    try {
        return decodeURIComponent(hash);
    } catch {
        return hash;
    }
}

/** The folder of the project, for the background service, which is not told the project either */
export function currentProject(): { url: string; folder: string } {
    const w = window as unknown as { vis?: { projectPrefix?: string }; visAdapterInstance?: number };
    let project = (w.vis?.projectPrefix || '').replace(/\/+$/, '');
    if (!project) {
        // `index.html?main` is the runtime of the project `main`
        project = window.location.search.replace(/^\?/, '').split('&')[0].split('=')[0] || 'main';
    }
    const folder = `vis-2.${w.visAdapterInstance ?? 0}/${project}`;
    return { url: `../${folder}`, folder };
}
