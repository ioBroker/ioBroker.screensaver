/**
 * Which pictures of an album are shown today: all, those of the last days, those of a period, or those taken on
 * this day some years ago.
 *
 * A picture's date is a wall-clock time ("floating"): the hour the camera showed, without a time zone - EXIF has
 * none, and "taken on the 20th" must mean the 20th where the picture was taken, not in UTC. It is kept as the
 * milliseconds of a UTC date whose parts are the parts of the wall-clock time, so that day numbers are a division.
 */

export type DateFilterMode = 'all' | 'lastDays' | 'range' | 'onThisDay';

export interface DateFilter {
    mode: DateFilterMode;
    /** `lastDays`: today and the days before, 1 = today only */
    days?: number;
    /** `range`: first day, `YYYY-MM-DD`; empty = open */
    from?: string;
    /** `range`: last day, `YYYY-MM-DD`, included; empty = open */
    to?: string;
    /** `onThisDay`: 1 = today a year ago; 0 = this day in every year before this one */
    yearsAgo?: number;
    /** `onThisDay`: days before and after the day that count too */
    windowDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The longest window of `onThisDay`: two weeks to each side are still "around this day" */
const MAX_WINDOW_DAYS = 14;

/**
 * A wall-clock time as floating milliseconds
 *
 * @param date - a moment, read in the time zone of this process
 */
export function toFloating(date: Date): number {
    return Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
    );
}

/**
 * Floating milliseconds as `YYYY-MM-DDTHH:mm:ss`, the form the widgets read
 *
 * @param floating - see {@link toFloating}
 */
export function floatingToText(floating: number): string {
    return new Date(floating).toISOString().substring(0, 19);
}

/**
 * Read `YYYY-MM-DD` (or with a time) as floating milliseconds
 *
 * @param text - the date
 * @returns null where it is no date
 */
export function parseFloating(text: string | undefined | null): number | null {
    const match = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text || '');
    if (!match) {
        return null;
    }
    const [, y, m, d, hh, mm, ss] = match;
    const month = Number(m) - 1;
    const day = Number(d);
    if (month < 0 || month > 11 || day < 1 || day > 31) {
        return null;
    }
    return Date.UTC(Number(y), month, day, Number(hh || 0), Number(mm || 0), Number(ss || 0));
}

/**
 * The number of the day of a floating time
 *
 * @param floating - see {@link toFloating}
 */
export function dayNumber(floating: number): number {
    return Math.floor(floating / DAY_MS);
}

/**
 * The day number of a month and day in a year; the 29th of February is the 28th in other years
 *
 * @param year - the year
 * @param month - 0..11
 * @param day - 1..31
 */
function anniversary(year: number, month: number, day: number): number {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const d = month === 1 && day === 29 && !leap ? 28 : day;
    return dayNumber(Date.UTC(year, month, d));
}

/**
 * A number from a setting, kept between limits
 *
 * @param value - the setting
 * @param min - the smallest value
 * @param max - the largest value
 * @param fallback - where it is no number
 */
function limit(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/**
 * Read a filter from a message of a widget: whatever is missing or wrong, it is a filter that can be applied
 *
 * @param value - the `filter` of the message
 */
export function readDateFilter(value: unknown): DateFilter {
    const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const mode: DateFilterMode = v.mode === 'lastDays' || v.mode === 'range' || v.mode === 'onThisDay' ? v.mode : 'all';
    return {
        mode,
        days: limit(v.days, 1, 36600, 30),
        from: typeof v.from === 'string' ? v.from.trim() : '',
        to: typeof v.to === 'string' ? v.to.trim() : '',
        yearsAgo: limit(v.yearsAgo, 0, 200, 1),
        windowDays: limit(v.windowDays, 0, MAX_WINDOW_DAYS, 0),
    };
}

/**
 * Does a filter look at the date at all
 *
 * @param filter - the filter
 */
export function filtersByDate(filter: DateFilter): boolean {
    if (filter.mode === 'range') {
        return parseFloating(filter.from) !== null || parseFloating(filter.to) !== null;
    }
    return filter.mode !== 'all';
}

/**
 * A test for the date of a picture, made once for a day.
 *
 * A picture without a date never passes a filter that looks at the date: nobody knows when it was taken.
 *
 * @param filter - the filter
 * @param now - the floating time of now, see {@link toFloating}
 * @returns true for a date that is shown
 */
export function makeDateTest(filter: DateFilter, now: number): (floating: number | undefined) => boolean {
    const today = dayNumber(now);
    const known = (test: (day: number) => boolean) => (floating: number | undefined) =>
        typeof floating === 'number' && Number.isFinite(floating) && test(dayNumber(floating));

    switch (filter.mode) {
        case 'lastDays': {
            const first = today - (Math.max(1, filter.days || 1) - 1);
            return known(day => day >= first);
        }
        case 'range': {
            const from = parseFloating(filter.from);
            const to = parseFloating(filter.to);
            if (from === null && to === null) {
                return () => true;
            }
            const first = from === null ? -Infinity : dayNumber(from);
            const last = to === null ? Infinity : dayNumber(to);
            // typed the wrong way round: the period between the two days is still meant
            const [low, high] = first <= last ? [first, last] : [last, first];
            return known(day => day >= low && day <= high);
        }
        case 'onThisDay': {
            const date = new Date(now);
            const thisYear = date.getUTCFullYear();
            const month = date.getUTCMonth();
            const dayOfMonth = date.getUTCDate();
            const window = Math.min(MAX_WINDOW_DAYS, Math.max(0, filter.windowDays || 0));
            const yearsAgo = Math.max(0, filter.yearsAgo ?? 1);
            if (yearsAgo > 0) {
                const target = anniversary(thisYear - yearsAgo, month, dayOfMonth);
                return known(day => Math.abs(day - target) <= window);
            }
            // every year before this one: the day in the picture's year, or the one before or after it, where the
            // window reaches over New Year
            return known(day => {
                const year = new Date(day * DAY_MS).getUTCFullYear();
                for (const y of [year - 1, year, year + 1]) {
                    if (y < thisYear && Math.abs(day - anniversary(y, month, dayOfMonth)) <= window) {
                        return true;
                    }
                }
                return false;
            });
        }
        default:
            return () => true;
    }
}
