/**
 * The pictures of the palette: a symbol for its row, and a small drawing of the widget for its tooltip.
 *
 * Drawn as SVG and not taken as screenshots: they stay sharp at every size, need no file next to the bundle,
 * and show a landscape instead of somebody's family.
 */

const SKY =
    '<defs>' +
    '<linearGradient id="vis2ssSky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#5b6ea8"/><stop offset="0.55" stop-color="#f4a37a"/><stop offset="1" stop-color="#ffd27a"/>' +
    '</linearGradient>' +
    '<linearGradient id="vis2ssSea" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#3f8fb0"/><stop offset="1" stop-color="#1f5f7a"/>' +
    '</linearGradient>' +
    '</defs>';

function landscape(width: number, height: number): string {
    const horizon = Math.round(height * 0.62);
    return (
        `<rect width="${width}" height="${height}" fill="url(#vis2ssSky)"/>` +
        `<circle cx="${width * 0.56}" cy="${horizon - height * 0.08}" r="${height * 0.09}" fill="#fff3c4"/>` +
        `<path d="M0 ${horizon} L${width * 0.18} ${horizon - height * 0.2} L${width * 0.32} ${horizon - height * 0.08} ` +
        `L${width * 0.45} ${horizon - height * 0.16} L${width * 0.62} ${horizon} Z" fill="#5d6b7a" opacity="0.85"/>` +
        `<rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#vis2ssSea)"/>` +
        `<path d="M0 ${height} L0 ${height * 0.78} Q${width * 0.12} ${height * 0.7} ${width * 0.25} ${height * 0.8} ` +
        `L${width * 0.25} ${height} Z" fill="#3b4a35"/>`
    );
}

/** Symbol for the row of the photo frame */
export const FRAME_PREVIEW =
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none">' +
    '<rect x="3" y="5" width="26" height="22" rx="3" stroke="currentColor" stroke-width="2.2"/>' +
    '<circle cx="11" cy="12" r="2.4" fill="currentColor"/>' +
    '<path d="M5 24l7-7 4 4 5-6 7 8" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>' +
    '</svg>';

/** The photo frame as a tile, for the tooltip */
export const FRAME_PREVIEW_LARGE =
    `<svg viewBox="0 0 200 120" width="200" height="120">${SKY}` +
    '<clipPath id="vis2ssCard"><rect width="200" height="120" rx="10"/></clipPath>' +
    `<g clip-path="url(#vis2ssCard)">${landscape(200, 120)}` +
    '<rect y="84" width="200" height="36" fill="#000" opacity="0.18"/>' +
    // the caption as two quiet bars: a drawing that reads the same in every language
    '<rect x="10" y="95" width="62" height="6" rx="3" fill="#fff"/>' +
    '<rect x="10" y="106" width="42" height="4" rx="2" fill="#fff" opacity="0.8"/>' +
    '<g fill="#fff"><circle cx="92" cy="112" r="2"/><circle cx="100" cy="112" r="2" opacity="0.5"/>' +
    '<circle cx="108" cy="112" r="2" opacity="0.5"/></g>' +
    '</g></svg>';

/** Symbol for the row of the screensaver */
export const SCREENSAVER_PREVIEW =
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="none">' +
    '<rect x="2" y="5" width="28" height="19" rx="3" stroke="currentColor" stroke-width="2.2"/>' +
    '<path d="M11 28h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M19 9.5a5 5 0 1 0 4 6.5 4 4 0 0 1-4-6.5z" fill="currentColor"/>' +
    '</svg>';

/** The screensaver with the clock and the weather, for the tooltip */
export const SCREENSAVER_PREVIEW_LARGE =
    `<svg viewBox="0 0 200 120" width="200" height="120">${SKY}` +
    '<clipPath id="vis2ssScreen"><rect width="200" height="120" rx="6"/></clipPath>' +
    `<g clip-path="url(#vis2ssScreen)">${landscape(200, 120)}` +
    '<text x="190" y="30" text-anchor="end" font-family="sans-serif" font-size="24" fill="#fff">07:50</text>' +
    '<rect x="146" y="36" width="44" height="5" rx="2.5" fill="#fff" opacity="0.9"/>' +
    '<rect x="128" y="48" width="62" height="30" rx="5" fill="#1e2230" fill-opacity="0.3" stroke="#fff" stroke-opacity="0.4"/>' +
    '<circle cx="141" cy="60" r="4.5" fill="#ffb300"/>' +
    '<path d="M134 67h11a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.5 1A3 3 0 0 0 134 67z" fill="#fff"/>' +
    '<text x="152" y="64" font-family="sans-serif" font-size="9" font-weight="600" fill="#fff">-5°</text>' +
    '<rect x="152" y="68" width="28" height="3.5" rx="1.75" fill="#fff" opacity="0.85"/>' +
    '<g fill="#fff"><circle cx="92" cy="113" r="2"/><circle cx="100" cy="113" r="2" opacity="0.5"/>' +
    '<circle cx="108" cy="113" r="2" opacity="0.5"/></g>' +
    '</g></svg>';
