import type React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Connection } from '@iobroker/gui-components';
import { IobWebComponent } from '@iobroker/web-components/element';

import { setLanguageSource } from '../lib/i18n';
import type { ProjectLocation } from '../lib/useImageList';
import { getFilesUrl } from './files';

/**
 * The box the host gives: filled completely, nothing measured. `container-type` lets the words of a tile scale with
 * it (`cqmin`). The background stays transparent, the colours and the font come from the host.
 */
const CSS = `
:host { display: block; position: relative; width: 100%; height: 100%; overflow: hidden; }
.root { position: absolute; inset: 0; container-type: size; font-family: var(--iob-font-family, inherit); }
`;

/**
 * A web component of this set: the React of the host (`/lib/esm/react-19.js`) renders the components of the vis-2
 * widgets into a shadow root.
 *
 * The base class subscribes the states of `getStateIds` and draws again after every change; `renderContent` gives
 * what to draw. Drawn only once it is known where the host serves the file storage (see `files.ts`).
 */
export abstract class ReactWebComponent extends IobWebComponent {
    readonly #container: HTMLDivElement;

    #root: Root | null = null;

    #filesUrl: string | null = null;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = CSS;
        this.#container = document.createElement('div');
        this.#container.className = 'root';
        shadow.append(style, this.#container);

        void getFilesUrl().then(url => {
            this.#filesUrl = url;
            if (this.isConnected) {
                this.render();
            }
        });
    }

    /**
     * The connection as the components of the set take it. The contract names the methods a component may use
     * (`WebComponentSocket`); vis-2 and devices pass their whole `Connection`, which a folder as source needs
     * (`readDir`, `subscribeFiles`). Where a host passes less, the slideshow says so instead of failing.
     */
    protected get connection(): Connection | null {
        return (this.socket as unknown as Connection | null) || null;
    }

    /**
     * What to draw for the current settings, states and objects
     *
     * @param project - where the files lie; a web component has no project of vis-2
     */
    protected abstract renderContent(project: ProjectLocation): React.ReactNode;

    protected render(): void {
        if (this.#filesUrl === null) {
            return;
        }
        // every element of a page has the language of its host
        setLanguageSource(() => this.systemLang);
        this.#root ||= createRoot(this.#container);
        this.#root.render(this.renderContent({ url: '', folder: '', files: this.#filesUrl }));
    }

    disconnectedCallback(): void {
        super.disconnectedCallback();
        // A host that moves the element takes it out and puts it in again at once: the slideshow goes on then.
        // Out of the page for good, everything stops - timers, listeners, the overlay of the screensaver.
        queueMicrotask(() => {
            if (!this.isConnected && this.#root) {
                const root = this.#root;
                this.#root = null;
                root.unmount();
            }
        });
    }
}
