import type React from 'react';

/**
 * The CSS settings of a widget that belong to its card.
 *
 * The editor writes the CSS settings onto the outer box of a widget. A background set there would disappear
 * behind the pictures, and a frame would be drawn twice - around the box and around the card. So they are
 * taken off the outer box and given to the card, as the standard widgets of vis-2 do it: what was set wins
 * over what the card draws by itself, and what was not set changes nothing.
 */
export interface WidgetCss {
    /** What the card paints: its background, its frame, its shadow and the air inside it */
    frame: React.CSSProperties;
}

const FRAME_STYLES = [
    'background',
    'background-color',
    'background-image',
    'border',
    'border-color',
    'border-radius',
    'border-style',
    'border-width',
    'box-shadow',
    'padding',
    'padding-bottom',
    'padding-left',
    'padding-right',
    'padding-top',
];

/** What is written in the setting, with a bare number as pixels; nothing where it is empty */
function cssValue(value: unknown): string | number | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
        return parseFloat(value);
    }
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * The settings of the widget that its card has to know about
 *
 * @param style - the style of the widget as the project holds it
 */
export function readWidgetCss(style: unknown): WidgetCss {
    const frame: Record<string, string | number> = {};
    if (style && typeof style === 'object') {
        const all = style as Record<string, unknown>;
        for (const name of FRAME_STYLES) {
            const value = cssValue(all[name]);
            if (value !== undefined) {
                frame[name.replace(/-(\w)/g, (_all, letter: string) => letter.toUpperCase())] = value;
            }
        }
    }
    return { frame };
}

/**
 * What a card paints by itself, with what was set in the attributes over it.
 *
 * A short form and its long forms must not stand side by side: when the long one is taken back in the editor,
 * React removes it, and the part it stood for is then gone from the short one as well. So the defaults are given
 * in the long forms, and a short form that was set replaces them.
 *
 * @param defaults - what the card looks like when nothing was set
 * @param frame - what was set
 */
export function mergeFrame(defaults: React.CSSProperties, frame: React.CSSProperties): React.CSSProperties {
    const merged: React.CSSProperties = { ...defaults };
    if (frame.background !== undefined || frame.backgroundColor !== undefined || frame.backgroundImage !== undefined) {
        delete merged.background;
        delete merged.backgroundColor;
    }
    if (frame.border !== undefined) {
        delete merged.borderColor;
        delete merged.borderStyle;
        delete merged.borderWidth;
    }
    if (frame.padding !== undefined) {
        delete merged.paddingBottom;
        delete merged.paddingLeft;
        delete merged.paddingRight;
        delete merged.paddingTop;
    }
    return { ...merged, ...frame };
}
