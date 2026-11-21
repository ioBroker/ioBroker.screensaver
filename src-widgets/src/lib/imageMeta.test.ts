/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { displaySize, parseExifDate, readImageMeta } from './imageMeta';

/** Bytes, built piece by piece */
class Bytes {
    readonly data: number[] = [];

    constructor(private readonly littleEndian = false) {}

    get length(): number {
        return this.data.length;
    }

    u8(...values: number[]): this {
        this.data.push(...values.map(v => v & 0xff));
        return this;
    }

    u16(value: number): this {
        return this.littleEndian ? this.u8(value, value >> 8) : this.u8(value >> 8, value);
    }

    u32(value: number): this {
        return this.littleEndian
            ? this.u8(value, value >> 8, value >> 16, value >>> 24)
            : this.u8(value >>> 24, value >> 16, value >> 8, value);
    }

    text(value: string): this {
        return this.u8(...Array.from(new TextEncoder().encode(value)));
    }

    bytes(other: Bytes | number[]): this {
        this.data.push(...(Array.isArray(other) ? other : other.data));
        return this;
    }
}

interface ExifOptions {
    littleEndian?: boolean;
    orientation?: number;
    date?: string;
    /** degrees, minutes, seconds */
    lat?: [number, number, number, 'N' | 'S'];
    lon?: [number, number, number, 'E' | 'W'];
}

/** A TIFF structure as cameras write it into APP1: IFD0 with orientation, an EXIF IFD with the date and a GPS IFD */
function tiff(options: ExifOptions): Bytes {
    const le = options.littleEndian ?? true;
    const ifd0Count = 3;
    const ifd0Size = 2 + ifd0Count * 12 + 4;
    const exifAt = 8 + ifd0Size;
    const exifSize = 2 + 12 + 4;
    const dateAt = exifAt + exifSize;
    const date = `${options.date || '2023:07:14 18:22:05'}\0`;
    const gpsAt = dateAt + date.length;
    const gpsSize = 2 + 4 * 12 + 4;
    const latAt = gpsAt + gpsSize;
    const lonAt = latAt + 24;
    const lat = options.lat || [0, 0, 0, 'N'];
    const lon = options.lon || [0, 0, 0, 'E'];

    const b = new Bytes(le);
    b.text(le ? 'II' : 'MM').u16(42).u32(8);
    // IFD0
    b.u16(ifd0Count);
    b.u16(0x0112).u16(3).u32(1).u16(options.orientation || 1).u16(0);
    b.u16(0x8769).u16(4).u32(1).u32(exifAt);
    b.u16(0x8825).u16(4).u32(1).u32(gpsAt);
    b.u32(0);
    // EXIF IFD
    b.u16(1);
    b.u16(0x9003).u16(2).u32(date.length).u32(dateAt);
    b.u32(0);
    b.text(date);
    // GPS IFD
    b.u16(4);
    b.u16(1).u16(2).u32(2).text(lat[3]).u8(0, 0, 0);
    b.u16(2).u16(5).u32(3).u32(latAt);
    b.u16(3).u16(2).u32(2).text(lon[3]).u8(0, 0, 0);
    b.u16(4).u16(5).u32(3).u32(lonAt);
    b.u32(0);
    for (const value of [lat[0], lat[1], lat[2], lon[0], lon[1], lon[2]]) {
        b.u32(value).u32(1);
    }
    return b;
}

/** A JPEG segment: marker, length, data */
function segment(marker: number, data: Bytes): Bytes {
    return new Bytes().u8(0xff, marker).u16(data.length + 2).bytes(data);
}

function sof(width: number, height: number): Bytes {
    return segment(0xc0, new Bytes().u8(8).u16(height).u16(width).u8(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1));
}

function jpeg(...segments: Bytes[]): Uint8Array {
    const b = new Bytes().u8(0xff, 0xd8);
    segments.forEach(s => b.bytes(s));
    // the picture data starts, and a few bytes of it
    b.u8(0xff, 0xda).u16(8).u8(3, 1, 0, 2, 0x11, 3).u8(0x12, 0x34, 0xff, 0xd9);
    return new Uint8Array(b.data);
}

function exifSegment(options: ExifOptions): Bytes {
    return segment(0xe1, new Bytes().text('Exif\0\0').bytes(tiff(options)));
}

void describe('readImageMeta', () => {
    void it('reads size, orientation, date and GPS of a JPEG from a camera (Intel byte order)', () => {
        const meta = readImageMeta(
            jpeg(
                exifSegment({ orientation: 6, date: '2023:07:14 18:22:05', lat: [43, 30, 36, 'N'], lon: [16, 26, 24, 'E'] }),
                sof(4000, 3000),
            ),
        );
        assert.equal(meta.width, 4000);
        assert.equal(meta.height, 3000);
        assert.equal(meta.orientation, 6);
        assert.equal(meta.date?.getTime(), new Date(2023, 6, 14, 18, 22, 5).getTime());
        assert.ok(Math.abs((meta.latitude ?? 0) - 43.51) < 1e-9);
        assert.ok(Math.abs((meta.longitude ?? 0) - 16.44) < 1e-9);
        // turned by 90°: it is shown portrait
        assert.deepEqual(displaySize(meta), { width: 3000, height: 4000 });
    });

    void it('reads Motorola byte order and the southern and western half of the world', () => {
        const meta = readImageMeta(
            jpeg(exifSegment({ littleEndian: false, lat: [33, 52, 0, 'S'], lon: [151, 12, 0, 'W'] }), sof(800, 600)),
        );
        assert.ok((meta.latitude ?? 0) < -33.8);
        assert.ok((meta.longitude ?? 0) < -151.1);
        assert.equal(meta.orientation, 1);
    });

    void it('ignores the 0/0 of a phone without a GPS fix and the date of a camera without a clock', () => {
        const meta = readImageMeta(jpeg(exifSegment({ date: '0000:00:00 00:00:00' }), sof(800, 600)));
        assert.equal(meta.latitude, undefined);
        assert.equal(meta.longitude, undefined);
        assert.equal(meta.date, undefined);
    });

    void it('reads place and caption from XMP', () => {
        const xmp =
            '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description photoshop:City="Split" ' +
            'photoshop:Country="Kroatien" Iptc4xmpCore:Location="Bačvice">' +
            '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Am Strand &amp; in der Sonne</rdf:li></rdf:Alt>' +
            '</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>';
        const meta = readImageMeta(
            jpeg(segment(0xe1, new Bytes().text('http://ns.adobe.com/xap/1.0/\0').text(xmp)), sof(1000, 800)),
        );
        assert.equal(meta.place, 'Bačvice, Split');
        assert.equal(meta.caption, 'Am Strand & in der Sonne');
    });

    void it('reads place and caption from IPTC', () => {
        const record = (dataset: number, text: string): Bytes => {
            const bytes = new TextEncoder().encode(text);
            return new Bytes().u8(0x1c, 2, dataset).u16(bytes.length).u8(...Array.from(bytes));
        };
        const iptc = new Bytes().bytes(record(90, 'München')).bytes(record(101, 'Deutschland')).bytes(record(120, 'Oktoberfest'));
        const resource = new Bytes().text('8BIM').u16(0x0404).u8(0, 0).u32(iptc.length).bytes(iptc);
        const meta = readImageMeta(jpeg(segment(0xed, new Bytes().text('Photoshop 3.0\0').bytes(resource)), sof(640, 480)));
        assert.equal(meta.place, 'München, Deutschland');
        assert.equal(meta.caption, 'Oktoberfest');
    });

    void it('reads the size of a PNG', () => {
        const png = new Bytes().u8(0x89).text('PNG\r\n\x1a\n').u32(13).text('IHDR').u32(1920).u32(1080).u8(8, 6, 0, 0, 0).u32(0);
        png.u32(0).text('IEND').u32(0);
        const meta = readImageMeta(new Uint8Array(png.data));
        assert.equal(meta.width, 1920);
        assert.equal(meta.height, 1080);
    });

    void it('says nothing about a file it does not know or that is cut off', () => {
        assert.deepEqual(readImageMeta(new Uint8Array([1, 2, 3, 4])), {});
        assert.deepEqual(readImageMeta(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40])), {});
        assert.equal(displaySize({}), null);
    });
});

void describe('parseExifDate', () => {
    void it('reads the local time of the camera', () => {
        assert.equal(parseExifDate('2024:12:24 17:30:00')?.getTime(), new Date(2024, 11, 24, 17, 30, 0).getTime());
        assert.equal(parseExifDate('1970:00:00 00:00:00'), undefined);
        assert.equal(parseExifDate('garbage'), undefined);
        assert.equal(parseExifDate(undefined), undefined);
    });
});
