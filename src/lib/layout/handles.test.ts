import { describe, expect, it } from 'vitest';
import type { Rect } from '../document';
import { handleDragProps, handleLabelValue, layoutHandles, type HandleFrame } from './handles';

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

const PADDING = { Top: 10, Right: 20, Bottom: 30, Left: 40 };

function frame(overrides: Partial<HandleFrame> = {}): HandleFrame {
	return {
		bounds: rect(100, 100, 300, 200),
		mode: 'HORIZONTAL',
		wrap: false,
		spaceBetween: false,
		padding: PADDING,
		children: [rect(140, 110, 50, 60), rect(210, 110, 50, 60), rect(280, 110, 50, 60)],
		...overrides
	};
}

const START = { padding: PADDING, itemSpacing: 20, counterSpacing: 5 };
const NO_MODIFIERS = { altKey: false, shiftKey: false };

describe('layoutHandles', () => {
	it('puts a band on each padding side, inside the frame', () => {
		const handles = layoutHandles(frame({ children: [] }));
		expect(handles).toHaveLength(4);
		expect(handles[0]).toEqual({ kind: 'padding', side: 'Top', band: rect(140, 100, 240, 10) });
		expect(handles[1]).toEqual({ kind: 'padding', side: 'Right', band: rect(380, 110, 20, 160) });
		expect(handles[2]).toEqual({ kind: 'padding', side: 'Bottom', band: rect(140, 270, 240, 30) });
		expect(handles[3]).toEqual({ kind: 'padding', side: 'Left', band: rect(100, 110, 40, 160) });
	});

	it('adds a gap band between neighbours', () => {
		const gaps = layoutHandles(frame()).filter((handle) => handle.kind === 'gap');
		expect(gaps.map((handle) => handle.band)).toEqual([
			rect(190, 110, 20, 60),
			rect(260, 110, 20, 60)
		]);
	});

	it('uses the vertical axis for vertical stacks', () => {
		const handles = layoutHandles(
			frame({
				mode: 'VERTICAL',
				children: [rect(140, 110, 60, 30), rect(140, 160, 80, 30)]
			})
		);
		const gap = handles.find((handle) => handle.kind === 'gap');
		expect(gap?.band).toEqual(rect(140, 140, 80, 20));
	});

	it('shows no gap handles with space between, and line gaps for wrapped frames', () => {
		expect(
			layoutHandles(frame({ spaceBetween: true })).filter((h) => h.kind !== 'padding')
		).toEqual([]);
		const wrapped = layoutHandles(
			frame({
				wrap: true,
				children: [rect(140, 110, 50, 40), rect(210, 110, 50, 40), rect(140, 170, 50, 40)]
			})
		);
		expect(wrapped.filter((handle) => handle.kind === 'gap')).toHaveLength(1);
		const lineGap = wrapped.find((handle) => handle.kind === 'line-gap');
		expect(lineGap?.band).toEqual(rect(140, 150, 120, 20));
	});
});

describe('handleDragProps', () => {
	it('grows padding when the handle moves inward and rounds to whole units', () => {
		const left = { kind: 'padding', side: 'Left', band: rect(0, 0, 0, 0) } as const;
		const right = { kind: 'padding', side: 'Right', band: rect(0, 0, 0, 0) } as const;
		const bottom = { kind: 'padding', side: 'Bottom', band: rect(0, 0, 0, 0) } as const;
		expect(handleDragProps(left, 'HORIZONTAL', START, { x: 5.4, y: 99 }, NO_MODIFIERS)).toEqual({
			paddingLeft: 45
		});
		expect(handleDragProps(right, 'HORIZONTAL', START, { x: -7, y: 0 }, NO_MODIFIERS)).toEqual({
			paddingRight: 27
		});
		expect(handleDragProps(bottom, 'HORIZONTAL', START, { x: 0, y: -4 }, NO_MODIFIERS)).toEqual({
			paddingBottom: 34
		});
	});

	it('never goes below zero', () => {
		const top = { kind: 'padding', side: 'Top', band: rect(0, 0, 0, 0) } as const;
		expect(handleDragProps(top, 'HORIZONTAL', START, { x: 0, y: -50 }, NO_MODIFIERS)).toEqual({
			paddingTop: 0
		});
	});

	it('Alt mirrors the opposite side and Shift sets every side', () => {
		const left = { kind: 'padding', side: 'Left', band: rect(0, 0, 0, 0) } as const;
		expect(
			handleDragProps(left, 'HORIZONTAL', START, { x: 10, y: 0 }, { altKey: true, shiftKey: false })
		).toEqual({ paddingLeft: 50, paddingRight: 50 });
		expect(
			handleDragProps(left, 'HORIZONTAL', START, { x: 10, y: 0 }, { altKey: false, shiftKey: true })
		).toEqual({ paddingLeft: 50, paddingRight: 50, paddingTop: 50, paddingBottom: 50 });
	});

	it('drags the item spacing along the stacking axis and the row spacing vertically', () => {
		const gap = { kind: 'gap', band: rect(0, 0, 0, 0) } as const;
		const lineGap = { kind: 'line-gap', band: rect(0, 0, 0, 0) } as const;
		expect(handleDragProps(gap, 'HORIZONTAL', START, { x: 6, y: 50 }, NO_MODIFIERS)).toEqual({
			itemSpacing: 26
		});
		expect(handleDragProps(gap, 'VERTICAL', START, { x: 50, y: -6 }, NO_MODIFIERS)).toEqual({
			itemSpacing: 14
		});
		expect(handleDragProps(lineGap, 'HORIZONTAL', START, { x: 0, y: 3 }, NO_MODIFIERS)).toEqual({
			counterAxisSpacing: 8
		});
	});

	it('reads the value a label shows', () => {
		const left = { kind: 'padding', side: 'Left', band: rect(0, 0, 0, 0) } as const;
		expect(handleLabelValue(left, { paddingLeft: 12 })).toBe(12);
		expect(handleLabelValue({ kind: 'gap', band: rect(0, 0, 0, 0) }, { itemSpacing: 3 })).toBe(3);
	});
});
