/// <reference types="node" />
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { filtersByDate, floatingToText, makeDateTest, parseFloating, readDateFilter, toFloating } from './dateFilter';

/**
 * Floating time of a day
 *
 * @param text - `YYYY-MM-DD` or with a time
 */
function at(text: string): number {
    const value = parseFloating(text);
    assert.notEqual(value, null, text);
    return value;
}

describe('date filter', () => {
    const now = at('2026-11-20T09:30:00');

    it('keeps the wall-clock time of a date', () => {
        assert.equal(floatingToText(toFloating(new Date(2023, 6, 14, 18, 22, 5))), '2023-07-14T18:22:05');
        assert.equal(floatingToText(at('2024-02-29 07:05')), '2024-02-29T07:05:00');
        assert.equal(parseFloating('2024-13-01'), null);
        assert.equal(parseFloating('gestern'), null);
    });

    it('reads what a widget sends, whatever it is', () => {
        assert.deepEqual(readDateFilter(undefined), {
            mode: 'all',
            days: 30,
            from: '',
            to: '',
            yearsAgo: 1,
            windowDays: 0,
        });
        const filter = readDateFilter({ mode: 'onThisDay', yearsAgo: '2', windowDays: 99 });
        assert.equal(filter.yearsAgo, 2);
        assert.equal(filter.windowDays, 14);
        assert.equal(readDateFilter({ mode: 'everything' }).mode, 'all');
    });

    it('shows the last days, today included', () => {
        const test = makeDateTest(readDateFilter({ mode: 'lastDays', days: 7 }), now);
        assert.equal(test(at('2026-11-20T23:59:00')), true);
        assert.equal(test(at('2026-11-14T00:00:00')), true);
        assert.equal(test(at('2026-11-13T23:59:59')), false);
        assert.equal(test(undefined), false, 'no date, no match');
        const today = makeDateTest(readDateFilter({ mode: 'lastDays', days: 1 }), now);
        assert.equal(today(at('2026-11-20T00:01')), true);
        assert.equal(today(at('2026-11-19T23:59')), false);
    });

    it('shows a period, both days included, also typed the wrong way round', () => {
        const test = makeDateTest(readDateFilter({ mode: 'range', from: '2024-07-01', to: '2024-07-31' }), now);
        assert.equal(test(at('2024-07-01T00:00')), true);
        assert.equal(test(at('2024-07-31T23:59')), true);
        assert.equal(test(at('2024-08-01T00:00')), false);
        const reversed = makeDateTest(readDateFilter({ mode: 'range', from: '2024-07-31', to: '2024-07-01' }), now);
        assert.equal(reversed(at('2024-07-15')), true);
        const open = makeDateTest(readDateFilter({ mode: 'range', from: '2025-01-01' }), now);
        assert.equal(open(at('2030-01-01')), true);
        assert.equal(open(at('2024-12-31')), false);
        assert.equal(filtersByDate(readDateFilter({ mode: 'range' })), false, 'no day typed: all');
    });

    it('shows today a year ago', () => {
        const test = makeDateTest(readDateFilter({ mode: 'onThisDay', yearsAgo: 1 }), now);
        assert.equal(test(at('2025-11-20T08:00')), true);
        assert.equal(test(at('2025-11-21T08:00')), false);
        assert.equal(test(at('2024-11-20T08:00')), false, 'two years ago is not one year ago');
        const week = makeDateTest(readDateFilter({ mode: 'onThisDay', yearsAgo: 1, windowDays: 3 }), now);
        assert.equal(week(at('2025-11-23')), true);
        assert.equal(week(at('2025-11-24')), false);
    });

    it('shows this day in every year before this one, also over New Year', () => {
        const test = makeDateTest(readDateFilter({ mode: 'onThisDay', yearsAgo: 0 }), now);
        assert.equal(test(at('2019-11-20T12:00')), true);
        assert.equal(test(at('2025-11-20T12:00')), true);
        assert.equal(test(at('2026-11-20T08:00')), false, 'today is no memory');
        assert.equal(test(at('2019-11-21T12:00')), false);

        const newYear = makeDateTest(
            readDateFilter({ mode: 'onThisDay', yearsAgo: 0, windowDays: 3 }),
            at('2027-01-01'),
        );
        assert.equal(newYear(at('2024-12-30')), true, 'two days before New Year of 2025');
        assert.equal(newYear(at('2026-12-30')), false, 'two days ago is no memory');
        assert.equal(newYear(at('2027-01-02')), false, 'this year');
    });

    it('takes the 28th of February for the 29th in other years', () => {
        const test = makeDateTest(readDateFilter({ mode: 'onThisDay', yearsAgo: 1 }), at('2028-02-29'));
        assert.equal(test(at('2027-02-28')), true);
        assert.equal(test(at('2027-03-01')), false);
    });
});
