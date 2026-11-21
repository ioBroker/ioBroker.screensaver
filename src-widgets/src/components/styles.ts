/**
 * The keyframes of the slideshow, put into the page once.
 *
 * Everything that moves is `transform` and `opacity`: the two properties a browser animates on the graphics
 * chip without laying out or painting the page again. That is what keeps a cross-fade and the slow zoom smooth
 * on an old wall tablet, where animating `width`, `left` or a `filter` would stutter.
 */

const STYLE_ID = 'vis2-screensaver-styles';

/** Four kinds of slow zoom, so that the pictures do not all drift the same way */
export const KEN_BURNS_VARIANTS = 4;

const CSS = `
@keyframes vis2ss-kb-0 { from { transform: scale(1) translate(0, 0); } to { transform: scale(1.1) translate(-2%, -1%); } }
@keyframes vis2ss-kb-1 { from { transform: scale(1.1) translate(2%, 1%); } to { transform: scale(1) translate(0, 0); } }
@keyframes vis2ss-kb-2 { from { transform: scale(1) translate(0, 0); } to { transform: scale(1.1) translate(2%, -1.5%); } }
@keyframes vis2ss-kb-3 { from { transform: scale(1.08) translate(-1.5%, 1%); } to { transform: scale(1.01) translate(0, 0); } }
@keyframes vis2ss-pop {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
    15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    75% { opacity: 1; }
    100% { opacity: 0; }
}
@keyframes vis2ss-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
    .vis2ss-kb { animation: none !important; }
}
`;

/**
 * Put the keyframes into the page, once for all frames - or into the shadow root a frame lies in: the names of
 * keyframes do not cross the border of a shadow DOM reliably in every browser
 *
 * @param root - the root node of the frame; the document if missing
 */
export function ensureStyles(root?: Node): void {
    if (typeof document === 'undefined') {
        return;
    }
    const shadow = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root : null;
    if ((shadow || document).getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (shadow || document.head).appendChild(style);
}

/** White writing that stays readable on a bright sky as on a dark forest */
export const TEXT_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.55), 0 2px 14px rgba(0, 0, 0, 0.35)';
