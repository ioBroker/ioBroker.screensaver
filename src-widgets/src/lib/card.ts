import type React from 'react';

import type { VisTheme } from '@iobroker/types-vis-2';

/**
 * The card of the standard widgets of vis-2 (thermostat, window, energy flow), so that a photo frame sits among
 * them as one of them: the paper of the theme, a 12px corner, a 1px line in the colour of the dividers, and a
 * shadow in the light theme only - a dark theme draws its cards flat. Unlike the other tiles the picture goes to
 * the edge: a passe-partout of 16px would make a small tile a stamp.
 */
export const CARD_RADIUS = 12;

/**
 * The look of the card in the current theme
 *
 * @param theme - the theme of the editor or of the runtime
 */
export function cardStyle(theme: VisTheme | null | undefined): React.CSSProperties {
    const palette = theme?.palette;
    const light = palette?.mode !== 'dark';
    return {
        backgroundColor: palette?.background?.paper || (light ? '#fff' : '#1e1e1e'),
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: palette?.divider || (light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)'),
        borderRadius: CARD_RADIUS,
        boxShadow: light ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
    };
}
