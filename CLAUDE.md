# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

The ioBroker adapter `screensaver` (renamed from `vis-2-widgets-screensaver`; the folder and the git remote still
carry the old name). A **daemon backend** (`src/` → `build/src/main.js`) keeps albums, and a set of React widgets
that vis-2 loads through **Vite module federation**, plus one **vis-2 background service**:

- `PhotoFrame` — the slideshow as a tile, a page or a free widget
- `Screensaver` — only carries settings; in the editor a preview tile, in the runtime `null`
- `ScreensaverService` — rendered by the vis-2 runtime once per project (not in the editor), next to the views;
  reads the `Screensaver` widgets of all views and lies over whichever view is open after the idle time

Both also ship as **web components** (`@iobroker/web-components`) for devices, Aura and other hosts:
`<iob-screensaver-photo-frame>` and `<iob-screensaver>` in `admin/webcomponents/`, listed in `common.webComponents`.

Written from the requirement "Widget Bilderrahmen für vis-2" (Lückenliste, Punkt 33).

## Commands

```bash
npm run npm         # install both package trees (src-widgets needs `npm i -f`)
npm run build       # clean -> npm install in src-widgets -> vite build -> copy to widgets/ -> web components -> backend
npm run build:backend  # only the backend: tsc -p tsconfig.build.json -> build/
npm run check       # type check of the backend and of src-widgets
npm run lint        # eslint
npm run test:unit   # node:test via tsx: src/**/*.test.ts and src-widgets/src/**/*.test.ts (no browser)
npm run test:integration  # boots js-controller + web + vis-2 and a browser; refuses while a local ioBroker runs
```

Single build stages: `npx tsx tasks.ts --widget-2-compile` then `--widget-3-copy` for a quick rebuild;
`npm run widget-4-webcomponents` builds only the web components (and rewrites `common.webComponents`).

## Architecture

### The backend (`src/`)

- `main.ts` — the adapter. Widgets ask with `sendTo`: `getAlbums` (`[{value,label}]`, also for `selectSendTo` of the
  web component manifests), `list {album, filter, fallback, limit}`, `picture {album, key, width, height}` → `{url}`
  (a path below the file storage), `rescan`, `testImmich`, `googleConnect`/`googleSettings`/`googleDisconnect`
  (buttons of `admin/jsonConfig.json`). Status words of the backend come from `admin/i18n/<system language>.json`.
- `lib/albums.ts` — albums of the config; `list` applies the date filter (`lib/dateFilter.ts`, floating wall-clock
  times: UTC millis whose parts are the local parts), falls back to all, takes a seeded daily sample above 3000.
- `lib/albumIndex.ts` — scan per album; opens only new/changed files (size+mtime) and reads EXIF with the widgets'
  `src-widgets/src/lib/imageMeta.ts` (compiled along: `rootDir: '.'`, `module: CommonJS`); date from file name as
  fallback; index stored as JSON in the instance data dir.
- `lib/sources.ts` — `StorageSource` (ioBroker files; reads the head from `iobroker-data/files/` on disk when it is
  there), `PathSource` (server folder, key may not leave the root). `lib/immich.ts` — REST client (`x-api-key`,
  `/search/metadata` with `albumIds`, previews ≤1440 px, originals above via sharp).
- `lib/pictureCache.ts` — reduced JPEGs in `screensaver.0/cache/<album>/<hash>_<edge>.jpg` (edges 960…3840),
  `rotate()` + `keepExif()` so date/place stay; LRU by size. Small browser-ready files of the storage are answered
  with their own path. sharp is optional at runtime (`require` in try).
- `lib/googlePhotos.ts` + `lib/googleConnection.ts` — Google Photos through the **Ambient API** (needs the Google
  Photos partner program for the OAuth client of ioBroker). Device flow (code on google.com/device) through the
  OAuth service of ioBroker (`oauth2.iobroker.in/googlephotos/{device,token,refresh}`, repo `iobroker.google-oauth`,
  `lambda/lib/googlePhotos.ts`; the client secret lives only there). The `requestId` of the device code is reused for
  `devices.create`, so the consent ends in the device's settings in the app. The account (refresh token encrypted
  with `this.encrypt`, deviceId, requestId) is kept in `native.account` of the object `screensaver.0.google` - not in
  the instance config, so a save of the settings page cannot overwrite it and no restart follows. States
  `google.state`/`google.connected`/`google.status` (HTML for the `state` control of the settings). Budget:
  `mediaItems.list` 240×/device/day → list cached 3 h, ≤500 items, `baseUrl` (60 min) refreshed on demand.
- `lib/immichDocker.ts` + `docker-compose.yaml` — optional Immich in Docker through `@iobroker/plugin-docker`
  (`common.plugins.docker`, like the adapters `sql` and `frigate`). All services carry `iobWaitForReady`: `main.ts`
  creates the folder of the photos (`native.dockerImmich.location`, must start with `/`) and then calls
  `instanceIsReady()` **without awaiting it**: it resolves only after the image pulls (minutes; with
  `iobAutoImageUpdate` a registry check on every start), and `onReady` must not wait for that. A folder it cannot
  create (EACCES) gives the status `folderMissing` with the `sudo mkdir` command, and no container starts - Docker
  does not create bind sources. `lib/photoFolder.ts` checks the folder (exists / ioBroker may create it / not / a
  folder above is closed); the settings show it below the folder field while it is chosen (`textSendTo`, command
  `checkFolder`, asked again on each change). Images by **tag only**, unlike Immich's own file: the plugin finds a pulled image as
  `repository:tag` of Docker's list, so a `@sha256:` digest or a `docker.io/` prefix is "not found after pull". The plugin prefixes names with `iob_screensaver_<instance>_`, so the server gets the hostnames
  of database/redis/ML in its environment. The environment of the server is a **list**: a value that is one whole
  `${config…}` pattern becomes a boolean, which never equals Docker's "true" and recreates the container on every
  check. Machine learning has its own `iobEnabled`; the settings uncheck it with Docker (`onChange`), `main.ts` too.
  `ImmichDocker` waits for `/api/server/ping`, signs up the admin on a new Immich (`immichEmail`/`immichPassword`),
  signs in, creates a read-only API key, signs out; the key lives encrypted in `native.key` of `screensaver.0.immich`.
  Albums of type `immich` get the client as a function and are scanned when it is ready. The test runs the real
  compose file through the plugin's own parse/template/convert steps.
- `screensaver.0` is a `meta` object (instanceObjects `_id: ""`), so the cache is served by web (`/screensaver.0/…`)
  and admin (`/files/screensaver.0/…`).

### The widgets

Three lists must stay in sync: `exposes` in `src-widgets/vite.config.ts`, `common.visWidgets.vis2screensaverWidgets`
(`components` **and** `services`) in `io-package.json`, and the module files. `bundlerType` must be `"module"`.
Shared modules come from `moduleFederationShared(pack)` — never a hand-written list (vis-2 refuses a set that does
not share `react/jsx-runtime`).

### The parts

- `lib/slideEngine.ts` — the slideshow without React: order, preloading, pairs of portraits, transitions, errors.
  Timers are injected, so `slideEngine.test.ts` runs a whole show with a fake clock. **Memory rule**: only the
  slide on screen, the leaving one during a transition, and the preloaded next one are alive; every
  `PreparedPhoto` must be `release()`d exactly once (the test asserts both).
- `lib/photoLoader.ts` — fetch → EXIF from the first 256 KB → decode → downscale to the frame on a canvas (max
  2880 px) → object URL; the blurred backdrop is a 48 px JPEG data URL. A cross-origin picture without CORS falls
  back to a plain `<img>` without metadata.
- `lib/imageMeta.ts` — own EXIF/XMP/IPTC reader (JPEG, PNG, WebP, GIF); no library on purpose.
- `lib/sources.ts` + `lib/useImageList.ts` — folder (readDir + `subscribeFiles` with debounce, re-read every
  15 min and after each round), URL list, state (JSON list / lines / single URL). A picture's key is its URL.
- `lib/adapterAlbum.ts` — source `adapter`: `list` via `sendTo` (20 s timeout → `album_unreachable`), refreshed
  every 15 min and at local midnight; each `PhotoRef` has `resolve(target)` that asks `picture` only when the engine
  loads it (`photoLoader.preparePhoto` awaits it). `components/AlbumField.tsx` is the select of the albums.
- `lib/config.ts` — reads widget data into `FrameConfig`/`ScreensaverConfig`. The screensaver's fields are
  `noBinding`, because the service gets the data **unresolved** (`VisServiceProps.widgets[].data`).
- `lib/attributes.ts` — attribute groups shared by both widgets (same field names on both).
- `components/SlideShow.tsx` — renders engine layers (fade/slide/Ken Burns via CSS only: opacity/transform),
  captions, dots, gestures, clock/weather (`InfoPanel`).
- `components/ScreensaverRunner.tsx` — idle tracking (window capture listeners), arming 8 s ahead (invisible, so the
  first picture is loaded), the overlay portal into `document.body`, and the **ghost-click guard**: the overlay
  stays until the finger is up, `touchend` is `preventDefault`ed (no compat mouse events), and `click`/`mousedown`/
  `mouseup` are swallowed for 450 ms. Used by the service, by the `Screensaver` widget as a fallback when
  `window.visRxWidget.FEATURES` lacks `'services'` (vis-2 < 2.20.2), and by the editor preview button.
- `lib/screensaver.ts` — which screensaver applies (view scope wins over project), enabled/dim states, current view
  (`window.vis.activeView`, fallback `location.hash`) and project (`window.vis.projectPrefix`).

### Web components

- `src-widgets/src/webcomponents/` + `src-widgets/vite.wc.config.ts`: a second Vite build (library mode, one entry
  per component, one shared chunk) into `admin/webcomponents/`, with the manifests (`manifests.ts`, words from
  `src/i18n/*.json`) and icons emitted next to the modules. After it, `iob-web-components sync-io-package` writes the
  short form of the manifests into `common.webComponents` — never edit that list by hand.
- React comes from the host: `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime` are external and mapped to
  `../../../lib/esm/react-19.js` (`getReactImportPath`). Nothing reachable from the entries may import
  `@iobroker/gui-components`, MUI or emotion as a value — that is why `lib/i18n.ts` reads `window.sysLang` (set by
  gui-components' `I18n` in vis-2) and the web components call `setLanguageSource()`. Check the output for
  `@mui`/`gui-components` after changing `SlideShow`/`ScreensaverRunner` imports.
- `element.ts` (`ReactWebComponent`) renders into a shadow root; `ensureStyles(root)` puts the keyframes into that
  shadow root (or the document for the overlay portal). Settings have the same names as the vis-2 attributes, so
  `lib/config.ts` reads both; the test checks that the manifest defaults equal the config defaults.
- File URLs: web serves the storage as `/<object>/<path>`, admin as `/files/<object>/<path>`. `files.ts` derives the
  server base from `import.meta.url` (`…/adapter/<adapter>/…`) and probes once with the adapter icon
  (`<adapter>.admin/<adapter>.svg`, content type must be SVG — a login page answers 200 too). `ProjectLocation.files`
  carries the prefix into `lib/sources.ts` (default `../` for vis-2).
- A host only has to pass `WebComponentSocket` methods; a folder source needs `readDir`/`subscribeFiles`, so
  `useImageList` reports `folder_unsupported` instead of failing.
- The screensaver tile runs `ScreensaverRunner` with `watch` (not in `editMode`); a tap renders a second runner with
  `startShown` instead of the watching one — never both, so two slideshows never run.
- vis-2 hides these components (native widgets of the same names win); devices shows them as tiles (no devices
  plugin in this adapter).

### Conventions

- The React-hooks lint rules of the compiler era are on: no ref reads/writes during render (use `useLatest` from
  `lib/hooks.ts`), no synchronous `setState` in an effect body (derive from a keyed result instead, see
  `useImageList`).
- i18n keys are stored unprefixed in `src-widgets/src/i18n/*.json` (11 languages); the prefix
  `screensaver_` comes from `Generic.getI18nPrefix()` and `translations.ts`. `lib/i18n.ts#t()` reads
  the set's own dictionaries directly, because the service draws words too.
- `visPrev`/`visPrevLarge` are inline SVG strings (`lib/previews.ts`), language-neutral.
- Place lookup via Nominatim is opt-in (`placeSource: 'osm'`) for privacy; cached in localStorage, ≤ 1 request/s.

### Build gotcha

`src-widgets/package.json` pins `@swc/core`/`@swc/wasm` to 1.15.47 via `overrides`: with swc 1.16.x
`vite-plugin-top-level-await` 1.6.0 fails in `generateBundle` with "missing field `type`".

The same plugin wraps every chunk that contains a dynamic `import()` into `Promise.all(...).then(async () => …)`,
but does not make the chunks importing it wait. When the lazy folder dialog sat in the chunk shared by the widgets,
`Generic` was still `undefined` while `PhotoFrame` was evaluated, and vis-2 refused the set with "Class extends value
undefined is not a constructor or null". So `components/FolderDialogLazy.ts` holds the only `import()` and is a chunk
of its own (`codeSplitting.groups` in `vite.config.ts`). After a build, `class extends window.visRxWidget` must be at
the top level of its chunk, not inside a `__tla` block — check before shipping any new `import()`.

## Releasing

`npm run release-patch|minor|major` (`@alcalzone/release-script`). Don't hand-edit versions or news; user-facing
notes go under `### **WORK IN PROGRESS**` in the README changelog.

## Open points

- Demo photos "Familie Müller" (free licence) for the download and the iobroker.click demo are not in the repo yet.
- The demo on iobroker.click (tile in project "Minimal für Tablet", own view with clock) is not set up yet.
