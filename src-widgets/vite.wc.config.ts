// @ts-expect-error no types
import react from '@vitejs/plugin-react';
import { checkManifest, getReactImportPath, REACT_SPECIFIERS } from '@iobroker/web-components';
import type { Plugin } from 'vite';

import { FRAME_TAG, MODULE_DIR, SCREENSAVER_TAG } from './src/webcomponents/constants';
import { buildIcons, buildManifests } from './src/webcomponents/manifests';

/**
 * The web components `<iob-screensaver-photo-frame>` and `<iob-screensaver>`: one Vite build with an entry each,
 * written to `admin/webcomponents/` with their manifests and icons (`common.webComponents` in io-package.json). Every
 * host - devices, Aura, vis-2, admin - loads them from `/adapter/screensaver/webcomponents/`.
 *
 * No module federation: the components are built from the same files as the vis-2 widgets, without MUI and without
 * gui-components, and take React from the host - `/lib/esm/react-19.js`, which web and admin serve. The import is
 * relative to the module, so it is found behind a reverse proxy with a path as well. Both entries share one chunk
 * with the slideshow; it lies next to them, so that the relative path to React is the same in every file.
 */

const REACT_PATH = getReactImportPath(`${MODULE_DIR}/${FRAME_TAG}.js`);

/** Writes the manifests and the icons next to the modules, checked like a host checks them */
function manifestFiles(): Plugin {
    return {
        name: 'screensaver-web-component-manifests',
        generateBundle() {
            for (const manifest of buildManifests()) {
                const problem = checkManifest(manifest);
                if (problem) {
                    this.error(`${manifest.tag}.json: ${problem}`);
                }
                this.emitFile({
                    type: 'asset',
                    fileName: `${manifest.tag}.json`,
                    // one line: with the words of eleven languages an indented file is twice as large
                    source: `${JSON.stringify(manifest)}\n`,
                });
            }
            for (const [fileName, source] of Object.entries(buildIcons())) {
                this.emitFile({ type: 'asset', fileName, source });
            }
        },
    };
}

export default {
    plugins: [react(), manifestFiles()],
    // the modules are loaded as they are: no `process` in a browser
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    publicDir: false,
    build: {
        target: 'es2022',
        outDir: `../admin/${MODULE_DIR}`,
        emptyOutDir: true,
        lib: {
            entry: {
                [FRAME_TAG]: './src/webcomponents/photoFrame.tsx',
                [SCREENSAVER_TAG]: './src/webcomponents/screensaver.tsx',
            },
            formats: ['es'],
            fileName: (_format: string, name: string): string => `${name}.js`,
        },
        rollupOptions: {
            external: [...REACT_SPECIFIERS],
            output: {
                paths: Object.fromEntries(REACT_SPECIFIERS.map(name => [name, REACT_PATH])),
                chunkFileNames: 'shared-[hash].js',
                // library mode keeps whitespace for the bundler of a consumer; these modules are loaded as they are
                minify: true,
            },
        },
    },
};
