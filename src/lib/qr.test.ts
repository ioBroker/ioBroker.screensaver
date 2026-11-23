import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import qrcode from 'qrcode-generator';

import { qrSvg } from './qr';

describe('QR codes', () => {
    it('draws every dark module once, in strokes along the rows', () => {
        const text = 'https://www.google.com/device';
        const code = qrcode(0, 'M');
        code.addData(text);
        code.make();
        const count = code.getModuleCount();
        const dark = new Set<string>();
        for (let row = 0; row < count; row++) {
            for (let col = 0; col < count; col++) {
                if (code.isDark(row, col)) {
                    dark.add(`${row + 4},${col + 4}`);
                }
            }
        }

        const svg = qrSvg(text);
        const path = /<path d="([^"]+)"/.exec(svg)?.[1] || '';
        const drawn = new Set<string>();
        for (const [, x, y, length] of path.matchAll(/M(\d+) (\d+)\.5h(\d+)/g)) {
            for (let i = 0; i < Number(length); i++) {
                const key = `${y},${Number(x) + i}`;
                assert.ok(!drawn.has(key), `drawn twice: ${key}`);
                drawn.add(key);
            }
        }
        assert.deepEqual([...drawn].sort(), [...dark].sort());
        assert.match(svg, new RegExp(`viewBox="0 0 ${count + 8} ${count + 8}"`));
        assert.match(svg, /<rect width="100%" height="100%" fill="white"\/>/);
        assert.ok(svg.length < 5000, String(svg.length));
    });
});
