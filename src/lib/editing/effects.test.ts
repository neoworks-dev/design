import { describe, expect, it } from 'vitest';
import { blendModeLabel, convertEffect, newEffect } from './effects';

describe('effects', () => {
	it('switches between shadows keeping values, and to a blur keeping the radius', () => {
		const shadow = { ...newEffect('DROP_SHADOW'), radius: 9 };
		expect(convertEffect(shadow, 'INNER_SHADOW')).toMatchObject({
			type: 'INNER_SHADOW',
			radius: 9
		});
		expect(convertEffect(shadow, 'LAYER_BLUR')).toEqual({
			type: 'LAYER_BLUR',
			visible: true,
			radius: 9,
			blurType: 'NORMAL'
		});
		expect(convertEffect(newEffect('LAYER_BLUR'), 'DROP_SHADOW')).toMatchObject({
			type: 'DROP_SHADOW',
			radius: 4,
			offset: { x: 0, y: 4 }
		});
	});

	it('labels blend modes', () => {
		expect(blendModeLabel('COLOR_DODGE')).toBe('Color dodge');
		expect(blendModeLabel('PASS_THROUGH')).toBe('Pass through');
	});
});
