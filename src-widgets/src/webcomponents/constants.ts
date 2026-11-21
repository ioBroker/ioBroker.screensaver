/**
 * The names of the web components. Read by the build (`vite.wc.config.ts`) and by the modules, so that the tag a
 * module defines is the one its manifest names.
 */

/** The adapter; its admin folder is served as `/adapter/<adapter>/` and stored as `<adapter>.admin` */
export const ADAPTER = 'screensaver';

/** Where the modules and manifests lie in the admin folder of the adapter */
export const MODULE_DIR = 'webcomponents';

/** The photo frame as a web component */
export const FRAME_TAG = 'iob-screensaver-photo-frame';

/** The screensaver as a web component: a tile that lies over the whole page after the waiting time */
export const SCREENSAVER_TAG = 'iob-screensaver';
