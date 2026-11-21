import translations from '../translations';

export const I18N_PREFIX = 'screensaver_';

type Dictionary = Record<string, string>;

const DICTIONARIES = translations as unknown as Record<string, Dictionary>;

/**
 * Where the language comes from. In vis-2 it is `window.sysLang`, which `I18n` of gui-components keeps there - so
 * the copy of a widget set sees the language vis-2 set, without importing gui-components: the web components are
 * built from the same files and take React from the host, not gui-components with MUI. A web component sets the
 * language of its host instead.
 */
let languageSource: () => string | null | undefined = () =>
    typeof window === 'undefined' ? undefined : (window as { sysLang?: string }).sysLang;

/**
 * Take the language from somewhere else than vis-2: a web component takes the one of its host
 *
 * @param source - gives the language, e.g. `de`
 */
export function setLanguageSource(source: () => string | null | undefined): void {
    languageSource = source;
}

/** The language of the page, one of the languages of the set; `en` otherwise */
export function getLanguage(): ioBroker.Languages {
    let lang: string | null | undefined;
    try {
        lang = languageSource();
    } catch {
        lang = undefined;
    }
    return lang && lang !== 'prefix' && DICTIONARIES[lang] ? (lang as ioBroker.Languages) : 'en';
}

/**
 * A word of this widget set in the language of the page.
 *
 * Read from the dictionaries of this set directly and not through vis-2: the background service of the
 * screensaver and the web components draw words too, and they do not depend on vis-2 having registered the words
 * of the set.
 *
 * @param key - the key without prefix
 * @param args - values for `%s` in the text
 */
export function t(key: string, ...args: (string | number)[]): string {
    // vis-2 hands this very object to `I18n.extendTranslations` of gui-components, which replaces every language by
    // a copy whose keys carry the prefix: after that the word is only found with it
    const find = (dict: Dictionary | undefined): string | undefined => dict?.[key] ?? dict?.[`${I18N_PREFIX}${key}`];
    let text = find(DICTIONARIES[getLanguage()]) ?? find(DICTIONARIES.en) ?? key;
    for (const arg of args) {
        text = text.replace('%s', String(arg));
    }
    return text;
}
