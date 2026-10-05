import { describe, expect, it } from 'vitest';
import { defaultStroke, newPaint } from './paints';
import {
	changeFirstStroke,
	changeStrokePaints,
	dashAndGap,
	perSideWeights,
	uniformWeight,
	withSideWeight
} from './strokes';

describe('stroke edits', () => {
	it('creates a default stroke when there is none', () => {
		const [created] = changeFirstStroke([], (stroke) => ({ ...stroke, weight: 3 }));
		expect(created).toMatchObject({ weight: 3, align: 'INSIDE', cap: 'NONE', join: 'MITER' });
	});

	it('leaves the other strokes alone', () => {
		const second = { ...defaultStroke([newPaint('stroke')]), weight: 9 };
		const strokes = changeFirstStroke([defaultStroke([newPaint('stroke')]), second], (stroke) => ({
			...stroke,
			align: 'CENTER'
		}));
		expect(strokes[0].align).toBe('CENTER');
		expect(strokes[1]).toBe(second);
	});

	it('drops a stroke whose last paint is removed', () => {
		const strokes = [defaultStroke([newPaint('stroke')])];
		expect(changeStrokePaints(strokes, () => [])).toEqual([]);
		expect(changeStrokePaints([], (paints) => [...paints, newPaint('stroke')])).toHaveLength(1);
	});
});

describe('weights', () => {
	it('expands to four sides and collapses to the largest', () => {
		expect(perSideWeights(2)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
		expect(uniformWeight({ top: 1, right: 4, bottom: 2, left: 0 })).toBe(4);
		expect(withSideWeight(2, 'left', 5)).toEqual({ top: 2, right: 2, bottom: 2, left: 5 });
	});

	it('reads dash and gap from a pattern', () => {
		expect(dashAndGap([])).toEqual({ dash: 0, gap: 0 });
		expect(dashAndGap([6])).toEqual({ dash: 6, gap: 6 });
		expect(dashAndGap([6, 2])).toEqual({ dash: 6, gap: 2 });
	});
});
