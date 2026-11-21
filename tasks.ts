/*!
 * ioBroker build tasks of the screensaver: the backend, the vis-2 widgets and the web components.
 *
 * Executed with `tsx` (see the `build` and `widget-*` scripts in package.json), so this file is type checked by
 * the root tsconfig.json like the rest of the repository.
 */
import { deleteFoldersRecursive, npmInstall, buildReact, copyFiles } from '@iobroker/build-tools';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const { name } = JSON.parse(readFileSync(`${__dirname}/package.json`, 'utf8')) as { name: string };

/** Name of the adapter without the `iobroker.` prefix, e.g. `screensaver` */
const adapterName = name.replace('iobroker.', '');

const SRC = 'src-widgets/';
const src = `${__dirname}/${SRC}`;

/** Remove the Vite output, the published widget folder and the compiled backend */
function clean(): void {
    deleteFoldersRecursive(`${src}build`);
    deleteFoldersRecursive(`${__dirname}/widgets`);
    deleteFoldersRecursive(`${__dirname}/build`);
}

/** Compile the backend (`src/`) into `build/`, with the EXIF reader it shares with the widgets */
function buildBackend(): void {
    deleteFoldersRecursive(`${__dirname}/build`);
    execFileSync(process.execPath, [`${__dirname}/node_modules/typescript/bin/tsc`, '-p', 'tsconfig.build.json'], {
        cwd: __dirname,
        stdio: 'inherit',
    });
}

/** Run the Vite build of the widget sources */
function compile(): Promise<void> {
    return buildReact(src, { rootDir: __dirname, vite: true });
}

/** Copy the Vite output into `widgets/<adapter>/`, which is what vis-2 loads at runtime */
function copyAllFiles(): void {
    copyFiles(
        [
            `${SRC}build/**/*`,
            // Entry page of the stand-alone dev server, not part of the widget set
            `!${SRC}build/index.html`,
            // Statistics of the federation build. `mf-manifest.json` is NOT excluded: vis-2 reads it to see
            // which modules this widget set shares, and refuses a set that does not share `react/jsx-runtime`.
            `!${SRC}build/mf-stats.json`,
            `!${SRC}build/customWidgets.ssr.js`,
        ],
        `widgets/${adapterName}/`,
    );

    // Stub of the web adapter for the dev server (`public/_socket/info.js`), never used at runtime. It cannot
    // be dropped with a `!` pattern: `collectFiles()` strips a different base folder off an exclusion that
    // points into a subfolder, so its name never matches the one of the included file.
    rmSync(`${__dirname}/widgets/${adapterName}/_socket`, { recursive: true, force: true });

    // Keep the standalone i18n files alongside the widgets
    copyFiles([`${SRC}src/i18n/*.json`], `widgets/${adapterName}/i18n`);
}

/**
 * Build the web components into `admin/webcomponents/` (see `src-widgets/vite.wc.config.ts`), then write the short
 * form of their manifests into `common.webComponents` of io-package.json - for hosts that list the components of an
 * adapter that is not installed, from the repository alone.
 */
function buildWebComponents(): void {
    // `runner` loads the config with the JSON imports of the dictionaries, without the warning of native loading
    execFileSync(
        process.execPath,
        [`${src}node_modules/vite/bin/vite.js`, 'build', '-c', 'vite.wc.config.ts', '--configLoader', 'runner'],
        { cwd: src, stdio: 'inherit' },
    );
    execFileSync(
        process.execPath,
        [`${src}node_modules/@iobroker/web-components/build/bin.js`, 'sync-io-package', __dirname],
        { stdio: 'inherit' },
    );
}

/**
 * Report a failed stage and end the process with a non-zero exit code
 *
 * @param what - what did not work, e.g. `build`
 * @param e - the error that was thrown
 */
function fail(what: string, e: unknown): never {
    const message = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
    console.error(`Cannot ${what}: ${message}`);
    process.exit(2);
}

if (process.argv.includes('--widget-0-clean')) {
    clean();
} else if (process.argv.includes('--widget-1-npm')) {
    npmInstall(src).catch((e: unknown) => fail('install npm modules', e));
} else if (process.argv.includes('--widget-2-compile')) {
    compile().catch((e: unknown) => fail('build', e));
} else if (process.argv.includes('--widget-3-copy')) {
    copyAllFiles();
} else if (process.argv.includes('--backend')) {
    try {
        buildBackend();
    } catch (e) {
        fail('compile the backend', e);
    }
} else if (process.argv.includes('--widget-4-webcomponents')) {
    try {
        buildWebComponents();
    } catch (e) {
        fail('build the web components', e);
    }
} else {
    clean();
    npmInstall(src)
        .then(() => compile())
        .then(() => copyAllFiles())
        .then(() => buildWebComponents())
        .then(() => buildBackend())
        .catch((e: unknown) => fail('build', e));
}
