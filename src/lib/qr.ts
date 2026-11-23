/**
 * QR codes for the status texts of the settings: an SVG to put into the HTML of a `state` control
 */

import qrcode from 'qrcode-generator';

/** Modules of white around the code, as the scanners want it */
const QUIET_ZONE = 4;

/**
 * A QR code as SVG, dark on white: readable on the dark theme of admin too.
 * Dark modules side by side in a row are one stroke, so the SVG stays small (it is stored in a state).
 *
 * @param text - what the code says, like a URL
 * @param size - about this many pixels wide
 */
export function qrSvg(text: string, size = 140): string {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    const modules = count + 2 * QUIET_ZONE;
    const pixels = Math.max(2, Math.floor(size / modules)) * modules;
    let path = '';
    for (let row = 0; row < count; row++) {
        let col = 0;
        while (col < count) {
            if (!code.isDark(row, col)) {
                col++;
                continue;
            }
            const start = col;
            while (col < count && code.isDark(row, col)) {
                col++;
            }
            path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE + 0.5}h${col - start}`;
        }
    }
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${modules} ${modules}" shape-rendering="crispEdges">`,
        '<rect width="100%" height="100%" fill="white"/>',
        `<path d="${path}" stroke="black" stroke-width="1"/>`,
        '</svg>',
    ].join('');
}
