/**
 * What a picture file says about itself: its size, when it was taken, where, and a caption.
 *
 * Only the head of the file is needed - EXIF, XMP and IPTC of a JPEG sit in front of the picture data - so the
 * caller hands over the first few hundred kilobytes and not a 12 MB photo. No library: the parts that matter
 * here are a few dozen lines, and a widget set that ships an EXIF library ships mostly what it never reads.
 */

export interface ImageMeta {
    /** Size as stored, before the EXIF orientation is applied */
    width?: number;
    height?: number;
    /** EXIF orientation 1..8; 5 to 8 swap width and height */
    orientation?: number;
    /** When it was taken */
    date?: Date;
    latitude?: number;
    longitude?: number;
    /** A place written into the file: city, country, location */
    place?: string;
    /** A caption written into the file */
    caption?: string;
}

/** Reads numbers from a byte array in either byte order, and never past its end */
class Reader {
    constructor(
        private readonly bytes: Uint8Array,
        public littleEndian = false,
    ) {}

    get length(): number {
        return this.bytes.length;
    }

    u8(pos: number): number {
        return pos >= 0 && pos < this.bytes.length ? this.bytes[pos] : 0;
    }

    u16(pos: number): number {
        const a = this.u8(pos);
        const b = this.u8(pos + 1);
        return this.littleEndian ? a | (b << 8) : (a << 8) | b;
    }

    u32(pos: number): number {
        const a = this.u16(pos);
        const b = this.u16(pos + 2);
        return this.littleEndian ? (a + b * 0x10000) >>> 0 : (a * 0x10000 + b) >>> 0;
    }

    ascii(pos: number, length: number): string {
        let text = '';
        for (let i = 0; i < length && pos + i < this.bytes.length; i++) {
            const c = this.bytes[pos + i];
            if (c === 0) {
                break;
            }
            text += String.fromCharCode(c);
        }
        return text;
    }

    utf8(pos: number, length: number): string {
        const end = Math.min(this.bytes.length, pos + length);
        if (pos < 0 || pos >= end) {
            return '';
        }
        try {
            return new TextDecoder('utf-8').decode(this.bytes.subarray(pos, end));
        } catch {
            return this.ascii(pos, length);
        }
    }

    startsWith(pos: number, text: string): boolean {
        for (let i = 0; i < text.length; i++) {
            if (this.u8(pos + i) !== text.charCodeAt(i)) {
                return false;
            }
        }
        return true;
    }
}

/** EXIF tags that matter here */
const TAG = {
    ORIENTATION: 0x0112,
    EXIF_IFD: 0x8769,
    GPS_IFD: 0x8825,
    DATE_TIME: 0x0132,
    DATE_ORIGINAL: 0x9003,
    DATE_DIGITIZED: 0x9004,
    GPS_LAT_REF: 1,
    GPS_LAT: 2,
    GPS_LON_REF: 3,
    GPS_LON: 4,
};

/** Bytes per value of each EXIF type */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface IfdEntry {
    type: number;
    count: number;
    /** Where the value starts, relative to the start of the reader */
    valuePos: number;
}

/**
 * The entries of one IFD of a TIFF structure
 *
 * @param r - the reader, in the byte order of the TIFF
 * @param tiff - where the TIFF header starts
 * @param offset - offset of the IFD from the TIFF header
 */
function readIfd(r: Reader, tiff: number, offset: number): Map<number, IfdEntry> {
    const entries = new Map<number, IfdEntry>();
    const start = tiff + offset;
    if (offset < 8 || start + 2 > r.length) {
        return entries;
    }
    const count = Math.min(r.u16(start), 512);
    for (let i = 0; i < count; i++) {
        const pos = start + 2 + i * 12;
        if (pos + 12 > r.length) {
            break;
        }
        const tag = r.u16(pos);
        const type = r.u16(pos + 2);
        const valueCount = r.u32(pos + 4);
        const size = (TYPE_SIZE[type] || 1) * valueCount;
        // up to four bytes stand in the entry itself, longer values somewhere else
        const valuePos = size <= 4 ? pos + 8 : tiff + r.u32(pos + 8);
        entries.set(tag, { type, count: valueCount, valuePos });
    }
    return entries;
}

function readAscii(r: Reader, entry: IfdEntry | undefined): string | undefined {
    if (!entry || entry.type !== 2) {
        return undefined;
    }
    const text = r.ascii(entry.valuePos, Math.min(entry.count, 256)).trim();
    return text || undefined;
}

function readShort(r: Reader, entry: IfdEntry | undefined): number | undefined {
    if (!entry) {
        return undefined;
    }
    if (entry.type === 3) {
        return r.u16(entry.valuePos);
    }
    if (entry.type === 4) {
        return r.u32(entry.valuePos);
    }
    return undefined;
}

/** Degrees, minutes and seconds as three rationals */
function readDegrees(r: Reader, entry: IfdEntry | undefined): number | undefined {
    if (!entry || entry.type !== 5 || entry.count < 3) {
        return undefined;
    }
    let value = 0;
    for (let i = 0; i < 3; i++) {
        const num = r.u32(entry.valuePos + i * 8);
        const den = r.u32(entry.valuePos + i * 8 + 4);
        if (!den) {
            if (i === 0) {
                return undefined;
            }
            continue;
        }
        value += num / den / Math.pow(60, i);
    }
    return isFinite(value) ? value : undefined;
}

/**
 * A date of EXIF: `2023:07:14 18:22:05`, local time of the camera
 *
 * @param text - as written in the file
 */
export function parseExifDate(text: string | undefined): Date | undefined {
    const match = text?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/);
    if (!match) {
        return undefined;
    }
    const year = parseInt(match[1], 10);
    // cameras with an unset clock write 0000:00:00 or 1970
    if (year < 1900 || match[2] === '00') {
        return undefined;
    }
    const date = new Date(
        year,
        parseInt(match[2], 10) - 1,
        parseInt(match[3], 10),
        parseInt(match[4], 10),
        parseInt(match[5], 10),
        parseInt(match[6] || '0', 10),
    );
    return isNaN(date.getTime()) ? undefined : date;
}

/**
 * Read a TIFF structure: the EXIF of a JPEG, a PNG or a WebP
 *
 * @param bytes - the file
 * @param tiff - where the TIFF header (`II*\0` or `MM\0*`) starts
 * @param meta - where the result goes
 */
function readTiff(bytes: Uint8Array, tiff: number, meta: ImageMeta): void {
    const r = new Reader(bytes);
    if (r.startsWith(tiff, 'II')) {
        r.littleEndian = true;
    } else if (!r.startsWith(tiff, 'MM')) {
        return;
    }
    if (r.u16(tiff + 2) !== 42) {
        return;
    }
    const ifd0 = readIfd(r, tiff, r.u32(tiff + 4));

    const orientation = readShort(r, ifd0.get(TAG.ORIENTATION));
    if (orientation && orientation >= 1 && orientation <= 8) {
        meta.orientation = orientation;
    }

    let date: Date | undefined;
    const exifPointer = readShort(r, ifd0.get(TAG.EXIF_IFD));
    if (exifPointer) {
        const exif = readIfd(r, tiff, exifPointer);
        date =
            parseExifDate(readAscii(r, exif.get(TAG.DATE_ORIGINAL))) ||
            parseExifDate(readAscii(r, exif.get(TAG.DATE_DIGITIZED)));
    }
    date ||= parseExifDate(readAscii(r, ifd0.get(TAG.DATE_TIME)));
    if (date) {
        meta.date = date;
    }

    const gpsPointer = readShort(r, ifd0.get(TAG.GPS_IFD));
    if (gpsPointer) {
        const gps = readIfd(r, tiff, gpsPointer);
        const lat = readDegrees(r, gps.get(TAG.GPS_LAT));
        const lon = readDegrees(r, gps.get(TAG.GPS_LON));
        // a phone without a fix writes 0/0, which is the sea off the coast of Africa
        if (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0)) {
            const latRef = readAscii(r, gps.get(TAG.GPS_LAT_REF));
            const lonRef = readAscii(r, gps.get(TAG.GPS_LON_REF));
            meta.latitude = latRef === 'S' ? -lat : lat;
            meta.longitude = lonRef === 'W' ? -lon : lon;
        }
    }
}

function decodeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&amp;/g, '&')
        .trim();
}

/**
 * A property of XMP, written as attribute or as element; for a language alternative the default language
 *
 * @param xmp - the XMP packet
 * @param name - the qualified name, like `photoshop:City`
 */
function xmpValue(xmp: string, name: string): string | undefined {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const attr = xmp.match(new RegExp(`${escaped}="([^"]*)"`));
    if (attr?.[1]?.trim()) {
        return decodeXml(attr[1]);
    }
    const element = xmp.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`));
    if (!element) {
        return undefined;
    }
    const inner = element[1];
    const li = inner.match(/<rdf:li[^>]*xml:lang="x-default"[^>]*>([\s\S]*?)<\/rdf:li>/) || inner.match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
    const text = decodeXml((li ? li[1] : inner).replace(/<[^>]+>/g, ''));
    return text || undefined;
}

/**
 * Join the parts of a place, leaving out empty and repeated ones
 *
 * @param parts - location, city, state, country - the most exact first
 */
function joinPlace(parts: (string | undefined)[]): string | undefined {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const part of parts) {
        const text = part?.trim();
        if (text && !seen.has(text.toLowerCase())) {
            seen.add(text.toLowerCase());
            result.push(text);
        }
    }
    // a city and its country say enough; four parts are a postal address
    return result.length ? result.slice(0, 2).join(', ') : undefined;
}

/**
 * Read an XMP packet: place, caption and date as Lightroom, digiKam or a phone write them
 *
 * @param xmp - the packet
 * @param meta - where the result goes
 */
function readXmp(xmp: string, meta: ImageMeta): void {
    const place = joinPlace([
        xmpValue(xmp, 'Iptc4xmpCore:Location'),
        xmpValue(xmp, 'photoshop:City'),
        xmpValue(xmp, 'photoshop:Country') || xmpValue(xmp, 'Iptc4xmpCore:CountryName'),
    ]);
    if (place && !meta.place) {
        meta.place = place;
    }
    const caption = xmpValue(xmp, 'dc:description') || xmpValue(xmp, 'dc:title');
    if (caption && !meta.caption) {
        meta.caption = caption;
    }
    if (!meta.date) {
        const text = xmpValue(xmp, 'exif:DateTimeOriginal') || xmpValue(xmp, 'photoshop:DateCreated') || xmpValue(xmp, 'xmp:CreateDate');
        const date = text ? new Date(text) : undefined;
        if (date && !isNaN(date.getTime()) && date.getFullYear() >= 1900) {
            meta.date = date;
        }
    }
}

/**
 * Read the IPTC records of a Photoshop block (APP13): city, sublocation, country and caption
 *
 * @param r - the reader
 * @param start - start of the block, after `Photoshop 3.0\0`
 * @param end - end of the block
 * @param meta - where the result goes
 */
function readIptc(r: Reader, start: number, end: number, meta: ImageMeta): void {
    let pos = start;
    // find the resource 0x0404 among the 8BIM resources
    while (pos + 12 < end) {
        if (!r.startsWith(pos, '8BIM')) {
            return;
        }
        const id = r.u16(pos + 4);
        const nameLength = r.u8(pos + 6);
        // the name is padded to an even length, its length byte included
        let dataPos = pos + 6 + 1 + nameLength;
        if ((nameLength + 1) % 2) {
            dataPos++;
        }
        const size = r.u32(dataPos);
        dataPos += 4;
        if (id === 0x0404) {
            const records: Record<number, string> = {};
            let p = dataPos;
            const stop = Math.min(end, dataPos + size);
            while (p + 5 <= stop && r.u8(p) === 0x1c) {
                const record = r.u8(p + 1);
                const dataset = r.u8(p + 2);
                const length = r.u16(p + 3);
                if (record === 2) {
                    records[dataset] = r.utf8(p + 5, length).trim();
                }
                p += 5 + length;
            }
            const place = joinPlace([records[92], records[90], records[101]]);
            if (place && !meta.place) {
                meta.place = place;
            }
            if (records[120] && !meta.caption) {
                meta.caption = records[120];
            }
            return;
        }
        pos = dataPos + size + (size % 2);
    }
}

/** Start-of-frame markers of a JPEG, which carry its size */
function isStartOfFrame(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(bytes: Uint8Array, meta: ImageMeta): void {
    const r = new Reader(bytes);
    let pos = 2;
    let xmp: string | undefined;
    while (pos + 4 <= r.length) {
        if (r.u8(pos) !== 0xff) {
            // lost in the stream: stop rather than guess
            break;
        }
        const marker = r.u8(pos + 1);
        if (marker === 0xff) {
            pos++;
            continue;
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            pos += 2;
            continue;
        }
        const length = r.u16(pos + 2);
        const data = pos + 4;
        if (length < 2) {
            break;
        }
        if (marker === 0xe1 && r.startsWith(data, 'Exif\0\0')) {
            readTiff(bytes, data + 6, meta);
        } else if (marker === 0xe1 && r.startsWith(data, 'http://ns.adobe.com/xap/1.0/\0')) {
            xmp = r.utf8(data + 29, length - 2 - 29);
        } else if (marker === 0xed && r.startsWith(data, 'Photoshop 3.0\0')) {
            readIptc(r, data + 14, pos + 2 + length, meta);
        } else if (isStartOfFrame(marker)) {
            meta.height = r.u16(data + 1);
            meta.width = r.u16(data + 3);
        }
        if (marker === 0xda || marker === 0xd9) {
            // the picture data starts: nothing of interest follows
            break;
        }
        pos += 2 + length;
    }
    // XMP last: EXIF is the more exact source of the date, the XMP of the place and the caption
    if (xmp) {
        readXmp(xmp, meta);
    }
}

function readPng(bytes: Uint8Array, meta: ImageMeta): void {
    const r = new Reader(bytes);
    meta.width = r.u32(16);
    meta.height = r.u32(20);
    let pos = 8;
    while (pos + 12 <= r.length) {
        const length = r.u32(pos);
        const type = r.ascii(pos + 4, 4);
        if (type === 'eXIf') {
            readTiff(bytes, pos + 8, meta);
        } else if (type === 'iTXt' && r.startsWith(pos + 8, 'XML:com.adobe.xmp')) {
            readXmp(r.utf8(pos + 8, length), meta);
        } else if (type === 'IDAT' || type === 'IEND') {
            break;
        }
        pos += 12 + length;
    }
}

function readWebp(bytes: Uint8Array, meta: ImageMeta): void {
    const r = new Reader(bytes, true);
    let pos = 12;
    while (pos + 8 <= r.length) {
        const type = r.ascii(pos, 4);
        const size = r.u32(pos + 4);
        const data = pos + 8;
        if (type === 'VP8X') {
            meta.width = 1 + (r.u8(data + 4) | (r.u8(data + 5) << 8) | (r.u8(data + 6) << 16));
            meta.height = 1 + (r.u8(data + 7) | (r.u8(data + 8) << 8) | (r.u8(data + 9) << 16));
        } else if (type === 'VP8 ' && !meta.width) {
            meta.width = r.u16(data + 6) & 0x3fff;
            meta.height = r.u16(data + 8) & 0x3fff;
        } else if (type === 'VP8L' && !meta.width) {
            const bits = r.u32(data + 1);
            meta.width = (bits & 0x3fff) + 1;
            meta.height = ((bits >> 14) & 0x3fff) + 1;
        } else if (type === 'EXIF') {
            // some writers keep the `Exif\0\0` of a JPEG in front of the TIFF header
            readTiff(bytes, r.startsWith(data, 'Exif\0\0') ? data + 6 : data, meta);
        } else if (type === 'XMP ') {
            readXmp(r.utf8(data, size), meta);
        }
        pos = data + size + (size % 2);
    }
}

function readGif(bytes: Uint8Array, meta: ImageMeta): void {
    const r = new Reader(bytes, true);
    meta.width = r.u16(6);
    meta.height = r.u16(8);
}

/**
 * What the head of a picture file says about it.
 *
 * @param bytes - the first part of the file; 256 KB are plenty for every camera seen so far
 */
export function readImageMeta(bytes: Uint8Array): ImageMeta {
    const meta: ImageMeta = {};
    const r = new Reader(bytes);
    try {
        if (r.u8(0) === 0xff && r.u8(1) === 0xd8) {
            readJpeg(bytes, meta);
        } else if (r.startsWith(0, '\x89PNG')) {
            readPng(bytes, meta);
        } else if (r.startsWith(0, 'RIFF') && r.startsWith(8, 'WEBP')) {
            readWebp(bytes, meta);
        } else if (r.startsWith(0, 'GIF8')) {
            readGif(bytes, meta);
        }
    } catch {
        // a broken file is shown without what it would have told
    }
    if (!meta.width || !meta.height) {
        delete meta.width;
        delete meta.height;
    }
    return meta;
}

/**
 * The size of the picture as it is shown, with the EXIF orientation applied
 *
 * @param meta - what the file says
 */
export function displaySize(meta: ImageMeta): { width: number; height: number } | null {
    if (!meta.width || !meta.height) {
        return null;
    }
    return meta.orientation && meta.orientation >= 5
        ? { width: meta.height, height: meta.width }
        : { width: meta.width, height: meta.height };
}
