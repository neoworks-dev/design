import { describe, expect, it } from 'vitest';
import {
	hslToRgb,
	hsvToRgb,
	parseHex,
	rgbToHex,
	rgbToHsl,
	rgbToHsv,
	shiftLightness
} from './colorMath';

function close(actual: number, expected: number): void {
	expect(Math.abs(actual - expected)).toBeLessThan(1e-9);
}

describe('colour conversions', () => {
	it('round-trips arbitrary 0..1 floats through HSV and HSL without precision loss', () => {
		for (let step = 0; step < 500; step++) {
			const color = { r: Math.random(), g: Math.random(), b: Math.random() };
			const viaHsv = hsvToRgb(rgbToHsv(color));
			const viaHsl = hslToRgb(rgbToHsl(color));
			for (const channel of ['r', 'g', 'b'] as const) {
				close(viaHsv[channel], color[channel]);
				close(viaHsl[channel], color[channel]);
			}
		}
	});

	it('handles greys and primaries', () => {
		expect(rgbToHsv({ r: 0.5, g: 0.5, b: 0.5 })).toEqual({ h: 0, s: 0, v: 0.5 });
		expect(rgbToHsv({ r: 0, g: 1, b: 0 }).h).toBe(120);
		expect(hsvToRgb({ h: 240, s: 1, v: 1 })).toEqual({ r: 0, g: 0, b: 1 });
	});
});

describe('hex', () => {
	it('parses short, long and alpha forms', () => {
		expect(parseHex('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
		expect(parseHex('FF0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
		expect(parseHex('00000080')?.a).toBeCloseTo(128 / 255);
		expect(parseHex('nope')).toBeUndefined();
	});

	it('formats uppercase without hash', () => {
		expect(rgbToHex({ r: 1, g: 0.5, b: 0 })).toBe('FF8000');
	});
});

describe('shiftLightness', () => {
	it('lightens and darkens, clamped, keeping alpha', () => {
		const lighter = shiftLightness({ r: 0.5, g: 0.5, b: 0.5, a: 0.4 }, 0.1);
		close(lighter.r, 0.6);
		expect(lighter.a).toBe(0.4);
		expect(shiftLightness({ r: 0, g: 0, b: 0, a: 1 }, -0.5)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
	});
});
