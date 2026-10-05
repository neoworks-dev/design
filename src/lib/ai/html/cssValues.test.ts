import { describe, expect, it } from 'vitest';
import {
	blurRadius,
	parseBackgroundImage,
	parseRgbFunction,
	parseShadows,
	pixels,
	splitTopLevel,
	variableReference
} from './cssValues';

const parseColor = parseRgbFunction;

describe('css values', () => {
	it('splits outside of parentheses only', () => {
		expect(splitTopLevel('rgb(1, 2, 3) 0px 4px, red 1px 2px', ',')).toEqual([
			'rgb(1, 2, 3) 0px 4px',
			'red 1px 2px'
		]);
		expect(splitTopLevel('rgb(1, 2, 3) 0px  4px', ' ')).toEqual(['rgb(1, 2, 3)', '0px', '4px']);
	});

	it('reads pixel lengths and nothing else', () => {
		expect(pixels('12px')).toBe(12);
		expect(pixels('-1.5px')).toBe(-1.5);
		expect(pixels('0')).toBe(0);
		expect(pixels('50%')).toBeNull();
		expect(pixels('normal')).toBeNull();
	});

	it('finds a var() that is the whole value', () => {
		expect(variableReference('var(--space-4)')).toBe('--space-4');
		expect(variableReference(' var( --brand , #fff ) ')).toBe('--brand');
		expect(variableReference('calc(var(--a) * 2)')).toBeNull();
	});

	it('parses computed rgb() and rgba()', () => {
		expect(parseRgbFunction('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
		expect(parseRgbFunction('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
		expect(parseRgbFunction('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
		expect(parseRgbFunction('oklch(0.5 0.1 200)')).toBeNull();
	});

	it('parses a list of box shadows, inset included', () => {
		const shadows = parseShadows(
			'rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgb(255, 0, 0) 1px 2px 3px 0px inset',
			parseColor
		);
		expect(shadows).toEqual([
			{ inset: false, color: { r: 0, g: 0, b: 0, a: 0.1 }, x: 0, y: 4, blur: 6, spread: -1 },
			{ inset: true, color: { r: 1, g: 0, b: 0, a: 1 }, x: 1, y: 2, blur: 3, spread: 0 }
		]);
		expect(parseShadows('none', parseColor)).toEqual([]);
	});

	it('reads the blur radius of a filter', () => {
		expect(blurRadius('blur(8px)')).toBe(8);
		expect(blurRadius('saturate(2) blur(4px)')).toBe(4);
		expect(blurRadius('none')).toBe(0);
	});

	it('parses linear gradients with angles, sides and corners', () => {
		const angled = parseBackgroundImage(
			'linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)',
			parseColor
		);
		expect(angled.layers).toEqual([
			{
				kind: 'linear',
				direction: { kind: 'angle', degrees: 90 },
				stops: [
					{ color: { r: 1, g: 0, b: 0, a: 1 }, position: { value: 0, unit: '%' } },
					{ color: { r: 0, g: 0, b: 1, a: 1 }, position: { value: 100, unit: '%' } }
				]
			}
		]);
		const side = parseBackgroundImage(
			'linear-gradient(to left, rgb(0, 0, 0), rgb(255, 255, 255))',
			parseColor
		);
		expect(side.layers[0]).toMatchObject({ direction: { kind: 'angle', degrees: 270 } });
		const corner = parseBackgroundImage(
			'linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))',
			parseColor
		);
		expect(corner.layers[0]).toMatchObject({ direction: { kind: 'corner', x: 1, y: -1 } });
	});

	it('splits a stop with two positions and keeps open positions open', () => {
		const parsed = parseBackgroundImage(
			'linear-gradient(rgb(0, 0, 0) 10% 20%, rgb(255, 255, 255))',
			parseColor
		);
		expect(parsed.layers[0]).toMatchObject({
			direction: { kind: 'angle', degrees: 180 },
			stops: [
				{ position: { value: 10, unit: '%' } },
				{ position: { value: 20, unit: '%' } },
				{ position: null }
			]
		});
	});

	it('keeps url() layers and reports what it cannot read', () => {
		const parsed = parseBackgroundImage('url("a.png"), conic-gradient(red, blue)', parseColor);
		expect(parsed.layers).toEqual([{ kind: 'image', url: 'a.png' }]);
		expect(parsed.warnings).toHaveLength(1);
	});
});
