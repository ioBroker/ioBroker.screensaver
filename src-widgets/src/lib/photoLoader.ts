/**
 * Loading a picture so that a weak wall tablet can show it.
 *
 * A photo of 12 megapixels is 48 MB once decoded. A slideshow that hands such files to `<img>` keeps them
 * decoded in the memory of the tab, and on the tablets these frames run on that is what ended in the
 * "Out of Memory" and the frozen apps users reported of the old slideshow adapter. So every picture is drawn
 * once into a canvas of the size of the frame, and only that copy is kept: a 1280x800 frame keeps 4 MB per
 * picture, whatever the camera wrote. The large decode is let go right after.
 *
 * Along the way it reads what the file says about itself (EXIF), and paints the tiny, darkened copy that fills
 * the frame behind a picture shown whole.
 */

import { displaySize, readImageMeta, type ImageMeta } from './imageMeta';
import type { PhotoRef } from './sources';

export interface PreparedPhoto {
    ref: PhotoRef;
    /** What the `<img>` shows: an object URL of the reduced copy, or the original URL */
    src: string;
    /** A tiny, blurred and darkened copy as data URL, to fill the frame behind the picture */
    backdrop: string | null;
    /** Size as shown, orientation applied */
    width: number;
    height: number;
    meta: ImageMeta;
    /** Let go of the memory; the photo must not be shown afterwards */
    release: () => void;
}

/** How large a picture has to be, in device pixels */
export interface TargetSize {
    width: number;
    height: number;
}

/** What is read of a file to find its EXIF: the head, not the picture */
const META_BYTES = 256 * 1024;

/** The longest side ever kept, whatever the screen: 4K and more is not worth the memory of a tablet */
const MAX_SIDE = 2880;

/** Reduce only if that saves something: a picture 10 % too large is cheaper shown than redrawn */
const REDUCE_BELOW = 0.9;

function abortError(): Error {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
}

/**
 * An image element with the picture decoded
 *
 * @param src - the URL
 * @param signal - stops waiting for it
 */
function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        const img = new Image();
        img.decoding = 'async';
        const onAbort = (): void => {
            img.removeAttribute('src');
            reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        img.onload = () => {
            signal?.removeEventListener('abort', onAbort);
            // decode() leaves the main thread free; where it is missing or fails, the load event is enough
            const decoded = typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
            void decoded.then(() => (signal?.aborted ? reject(abortError()) : resolve(img)));
        };
        img.onerror = () => {
            signal?.removeEventListener('abort', onAbort);
            reject(new Error(`Cannot load ${src}`));
        };
        img.src = src;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise(resolve => {
        if (typeof canvas.toBlob !== 'function') {
            resolve(null);
            return;
        }
        canvas.toBlob(blob => resolve(blob), type, quality);
    });
}

/**
 * The scale that makes a picture large enough for the frame and not larger
 *
 * The picture has to cover the frame, whether it is shown whole or not: shown whole it is smaller than the
 * frame anyway, and cropped it must not be stretched. Never enlarged.
 *
 * @param width - width of the picture
 * @param height - height of the picture
 * @param target - the frame in device pixels
 */
export function reductionScale(width: number, height: number, target: TargetSize): number {
    if (!width || !height || !target.width || !target.height) {
        return 1;
    }
    let scale = Math.max(target.width / width, target.height / height);
    const longest = Math.max(width, height) * scale;
    if (longest > MAX_SIDE) {
        scale *= MAX_SIDE / longest;
    }
    return Math.min(1, scale);
}

/**
 * The tiny copy behind a picture shown whole: blurred and darkened, as Google Nest Hub and Apple TV do it
 * instead of black bars. Drawn at 48 px, so it costs nothing to keep, and stretched by CSS.
 *
 * @param img - the decoded picture
 */
function paintBackdrop(img: HTMLImageElement): string | null {
    try {
        const width = 48;
        const height = Math.max(1, Math.round((width * img.naturalHeight) / img.naturalWidth));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.min(height, 96);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        if ('filter' in ctx) {
            ctx.filter = 'blur(2px)';
        }
        ctx.drawImage(img, -2, -2, width + 4, canvas.height + 4);
        if ('filter' in ctx) {
            ctx.filter = 'none';
        }
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
    } catch {
        // a picture of another origin taints the canvas; it is shown on black then
        return null;
    }
}

/**
 * Fetch the file. A picture of another server may not allow it (CORS): then it is shown as it is, without
 * being reduced and without EXIF.
 *
 * @param url - the URL
 * @param signal - stops the download
 */
async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob | null> {
    if (url.startsWith('data:')) {
        return null;
    }
    try {
        const response = await fetch(url, { signal, credentials: 'same-origin' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.blob();
    } catch (e) {
        if (signal.aborted) {
            throw abortError();
        }
        if (e instanceof Error && /^HTTP /.test(e.message)) {
            // the server answered: the file is not there
            throw e;
        }
        return null;
    }
}

/**
 * Load a picture for the frame.
 *
 * @param ref - the picture
 * @param target - how large it will be shown at most, in device pixels
 * @param signal - cancels the loading, e.g. when the slideshow moved on
 * @param readMeta - read EXIF, XMP and IPTC
 */
export async function preparePhoto(
    ref: PhotoRef,
    target: TargetSize,
    signal: AbortSignal,
    readMeta = true,
): Promise<PreparedPhoto> {
    const url = ref.resolve ? await ref.resolve(target, signal) : ref.url;
    if (signal.aborted) {
        throw abortError();
    }
    const isSvg = /\.svg(\?|#|$)/i.test(url) || url.startsWith('data:image/svg');
    const blob = isSvg ? null : await fetchBlob(url, signal);

    let meta: ImageMeta = {};
    if (blob && readMeta && typeof blob.slice === 'function') {
        try {
            const head = await blob.slice(0, META_BYTES).arrayBuffer();
            meta = readImageMeta(new Uint8Array(head));
        } catch {
            meta = {};
        }
    }
    if (signal.aborted) {
        throw abortError();
    }

    const original = blob ? URL.createObjectURL(blob) : url;
    const urls: string[] = blob ? [original] : [];

    let img: HTMLImageElement;
    try {
        img = await loadImage(original, signal);
    } catch (e) {
        urls.forEach(url => URL.revokeObjectURL(url));
        throw e;
    }

    // the browser applies the EXIF orientation, so its size is the one shown
    const width = img.naturalWidth || displaySize(meta)?.width || 0;
    const height = img.naturalHeight || displaySize(meta)?.height || 0;

    let src = original;
    let shown: HTMLImageElement = img;
    const backdrop = isSvg ? null : paintBackdrop(img);

    const scale = reductionScale(width, height, target);
    if (blob && !isSvg && scale < REDUCE_BELOW) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const reduced = await canvasToBlob(canvas, 'image/jpeg', 0.9);
                // the canvas holds a decoded copy of its own: give it back at once
                canvas.width = 0;
                canvas.height = 0;
                if (reduced) {
                    const small = URL.createObjectURL(reduced);
                    urls.push(small);
                    const smallImg = await loadImage(small, signal);
                    // the copy is there: let go of the large decode and of the file
                    img.removeAttribute('src');
                    URL.revokeObjectURL(original);
                    urls.splice(urls.indexOf(original), 1);
                    src = small;
                    shown = smallImg;
                }
            }
        } catch (e) {
            if (signal.aborted) {
                urls.forEach(url => URL.revokeObjectURL(url));
                throw e;
            }
            // reducing failed: the original, still untouched, will do
            urls.filter(url => url !== original).forEach(url => URL.revokeObjectURL(url));
            urls.splice(0, urls.length, original);
            src = original;
            shown = img;
        }
    }

    if (signal.aborted) {
        urls.forEach(url => URL.revokeObjectURL(url));
        throw abortError();
    }

    let released = false;
    return {
        ref,
        src,
        backdrop,
        width,
        height,
        meta,
        release: () => {
            if (released) {
                return;
            }
            released = true;
            // the element keeps the decoded picture alive until its source is taken away
            shown.removeAttribute('src');
            urls.forEach(url => URL.revokeObjectURL(url));
        },
    };
}
