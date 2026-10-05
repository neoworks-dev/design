import { describe, expect, it } from 'vitest';
import {
	clampValue,
	evaluateExpression,
	formatNumber,
	parseFieldText,
	stepSize,
	stepValue
} from './numberField';

describe('evaluateExpression', () => {
	it('evaluates arithmetic with precedence and parentheses', () => {
		expect(evaluateExpression('10+5')).toBe(15);
		expect(evaluateExpression('2+3*4')).toBe(14);
		expect(evaluateExpression('(2+3)*4')).toBe(20);
		expect(evaluateExpression('-4 + 10 / 4')).toBe(-1.5);
		expect(evaluateExpression('.5*4')).toBe(2);
	});

	it('rejects anything that is not an expression', () => {
		for (const text of ['', 'abc', '1+', '(1', '1 2', '1/0', '2**3']) {
			expect(evaluateExpression(text)).toBeNull();
		}
	});
});

describe('parseFieldText', () => {
	it('accepts a trailing unit and relative operators', () => {
		expect(parseFieldText('12px', 0, 'px')).toBe(12);
		expect(parseFieldText('*2', 8)).toBe(16);
		expect(parseFieldText('/4', 8)).toBe(2);
		expect(parseFieldText('*2', null)).toBeNull();
		expect(parseFieldText('-5', 8)).toBe(-5);
	});
});

describe('helpers', () => {
	it('clamps, formats and steps', () => {
		expect(clampValue(5, 0, 3)).toBe(3);
		expect(clampValue(-1, 0)).toBe(0);
		expect(formatNumber(1.23456)).toBe('1.23');
		expect(formatNumber(10)).toBe('10');
		expect(formatNumber(-0.001)).toBe('0');
		expect(stepSize(1, { shift: true, alt: false })).toBe(10);
		expect(stepSize(1, { shift: false, alt: true })).toBe(0.1);
		expect(stepValue(0.1, 0.2)).toBe(0.3);
	});
});
