import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import translations from '../translations';
import { setLanguageSource, t } from './i18n';

describe('the words of the set', () => {
    it('are found before and after vis-2 registered them with their prefix', async () => {
        setLanguageSource(() => 'de');
        assert.equal(t('album_failed', 'immich'), 'Das Album kann nicht gelesen werden: immich');

        // vis-2 hands the same object to I18n.extendTranslations of gui-components, which replaces each language by
        // a copy whose keys carry the prefix (src-vis/src/Vis/visLoadWidgets.tsx, i18n: "component")
        (globalThis as { window?: unknown }).window ??= {};
        const { I18n } = (await import('@iobroker/gui-components/build/i18n.js')) as {
            I18n: { extendTranslations: (words: unknown) => void };
        };
        I18n.extendTranslations(translations);
        const de = (translations as unknown as Record<string, Record<string, string>>).de;
        assert.equal(de.album_failed, undefined, 'gui-components no longer renames the keys: the fallback can go');
        assert.ok(de.screensaver_album_failed);

        assert.equal(t('album_failed', 'immich'), 'Das Album kann nicht gelesen werden: immich');
        setLanguageSource(() => 'xx');
        assert.equal(t('album_failed', 'a'), 'The album cannot be read: a');
        assert.equal(t('no_such_word'), 'no_such_word');
    });
});
