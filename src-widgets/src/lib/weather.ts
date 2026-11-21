/**
 * Which symbol the weather card draws.
 *
 * Weather adapters disagree on how they say what the weather is: open-meteo gives a WMO code, others a text in
 * the language of the system, some the URL of an icon. All three are accepted, so that the card works with
 * whatever state the user has.
 */

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'sleet' | 'thunder';

/**
 * The kind of weather of a WMO code (as open-meteo and DWD write it)
 *
 * @param code - the code
 */
export function wmoToKind(code: number): WeatherKind | null {
    if (!isFinite(code) || code < 0) {
        return null;
    }
    if (code === 0) {
        return 'clear';
    }
    if (code === 1 || code === 2) {
        return 'partly';
    }
    if (code === 3) {
        return 'cloudy';
    }
    if (code === 45 || code === 48) {
        return 'fog';
    }
    if (code >= 51 && code <= 57) {
        return 'drizzle';
    }
    if (code === 66 || code === 67) {
        return 'sleet';
    }
    if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) {
        return 'rain';
    }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
        return 'snow';
    }
    if (code >= 95 && code <= 99) {
        return 'thunder';
    }
    return null;
}

/** Words that name a kind of weather, in the languages ioBroker speaks; the first match wins */
const WORDS: [WeatherKind, RegExp][] = [
    ['thunder', /gewitter|thunder|storm|гроз|onweer|orage|tempor|burz|temporale|tormenta|trovoada|雷/i],
    ['sleet', /schneeregen|sleet|graupel|hagel|hail|мокр|ijzel|grésil|grêle|grandine|aguanieve|granizo|deszcz ze śniegiem|雨夹雪|冰雹/i],
    ['snow', /schnee|snow|снег|сніг|sneeuw|neige|neve|nieve|śnieg|neve|雪/i],
    ['drizzle', /niesel|drizzle|морос|мряк|motregen|bruine|pioviggine|llovizna|mżawk|chuvisco|毛毛雨/i],
    ['rain', /regen|rain|schauer|shower|дожд|злив|regen|pluie|averse|pioggia|lluvia|chuva|deszcz|雨/i],
    ['fog', /nebel|fog|mist|dunst|haze|туман|mgła|brouillard|nebbia|niebla|nevoeiro|neblina|nevel|雾/i],
    [
        'partly',
        /heiter|teilweise|leicht bewölkt|wechselnd|partly|few clouds|scattered|переменн|малооблач|half bewolkt|partiellement|peu nuageux|parzialmente|poco nuvoloso|parcialmente|częściowe|небольш|多云间晴|局部多云/i,
    ],
    ['cloudy', /bewölkt|bedeckt|wolkig|cloud|overcast|облач|пасмурн|хмар|bewolkt|nuageux|couvert|nuvol|coperto|nublado|cubierto|pochmur|zachmurz|阴|多云/i],
    ['clear', /klar|sonnig|sonne|clear|sunny|fair|ясн|солн|helder|zonnig|dégagé|ensoleillé|sereno|soleggiato|despejado|soleado|limpo|ensolarado|bezchmur|słonecz|晴/i],
];

/**
 * The kind of weather a text names
 *
 * @param text - the text of the weather adapter
 */
export function textToKind(text: string): WeatherKind | null {
    for (const [kind, pattern] of WORDS) {
        if (pattern.test(text)) {
            return kind;
        }
    }
    return null;
}

/** What the state of the icon says: a picture to show, or a kind of weather to draw */
export type WeatherIcon = { url: string } | { kind: WeatherKind } | null;

/**
 * The symbol for the card
 *
 * @param icon - the value of the icon state: a WMO code, a text or the URL of a picture
 * @param text - the value of the text state, to fall back on
 */
export function weatherIcon(icon: unknown, text: unknown): WeatherIcon {
    if (typeof icon === 'number') {
        const kind = wmoToKind(icon);
        if (kind) {
            return { kind };
        }
    } else if (typeof icon === 'string' && icon.trim()) {
        const value = icon.trim();
        if (/^\d+$/.test(value)) {
            const kind = wmoToKind(parseInt(value, 10));
            if (kind) {
                return { kind };
            }
        } else if (/^(https?:|data:|\/|\.\.?\/)|\.(png|svg|gif|jpe?g|webp)(\?|$)/i.test(value)) {
            return { url: value };
        } else {
            const kind = textToKind(value);
            if (kind) {
                return { kind };
            }
        }
    }
    if (typeof text === 'string' && text.trim()) {
        const kind = textToKind(text);
        if (kind) {
            return { kind };
        }
    }
    return null;
}
