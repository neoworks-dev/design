import { describe, expect, it } from 'vitest';
import { createNode } from '../document';
import { alignmentProps, cellOf, flowOf } from './flow';

describe('flowOf', () => {
	it('maps layout mode and wrap onto the four buttons', () => {
		const frame = createNode('FRAME', { id: 'f' });
		expect(flowOf(frame)).toBe('NONE');
		expect(flowOf({ ...frame, layoutMode: 'VERTICAL' })).toBe('VERTICAL');
		expect(flowOf({ ...frame, layoutMode: 'HORIZONTAL' })).toBe('HORIZONTAL');
		expect(flowOf({ ...frame, layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' })).toBe('WRAP');
		expect(flowOf(createNode('RECTANGLE', { id: 'r' }))).toBeUndefined();
	});
});

describe('alignment grid', () => {
	it('reads columns as the horizontal axis whatever the direction', () => {
		expect(cellOf('HORIZONTAL', 'MAX', 'MIN')).toEqual({ column: 2, row: 0 });
		expect(cellOf('VERTICAL', 'MAX', 'MIN')).toEqual({ column: 0, row: 2 });
	});

	it('leaves the axis of space between and baseline unset', () => {
		expect(cellOf('HORIZONTAL', 'SPACE_BETWEEN', 'CENTER')).toEqual({ column: null, row: 1 });
		expect(cellOf('HORIZONTAL', 'CENTER', 'BASELINE')).toEqual({ column: 1, row: null });
	});

	it('writes both axes, but never replaces space between', () => {
		expect(alignmentProps('HORIZONTAL', 'MIN', { column: 2, row: 1 })).toEqual({
			primaryAxisAlignItems: 'MAX',
			counterAxisAlignItems: 'CENTER'
		});
		expect(alignmentProps('VERTICAL', 'MIN', { column: 2, row: 1 })).toEqual({
			primaryAxisAlignItems: 'CENTER',
			counterAxisAlignItems: 'MAX'
		});
		expect(alignmentProps('HORIZONTAL', 'SPACE_BETWEEN', { column: 2, row: 1 })).toEqual({
			counterAxisAlignItems: 'CENTER'
		});
	});
});
