import type { VisRxWidgetState } from '@iobroker/types-vis-2';
import type VisRxWidget from '@iobroker/types-vis-2/visRxWidget';

import { I18N_PREFIX } from './lib/i18n';

/**
 * The base of every widget of this set. The class itself comes from vis-2 at runtime (`window.visRxWidget`), so
 * the widgets render with the React and the MUI of vis-2 and never import a copy of the base class.
 */
export default class Generic<
    RxData extends Record<string, any>,
    State extends Partial<VisRxWidgetState> = VisRxWidgetState,
> extends (window.visRxWidget as typeof VisRxWidget)<RxData, State> {
    static getI18nPrefix(): string {
        return I18N_PREFIX;
    }
}
