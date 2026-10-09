import { describe, expect, it } from 'vitest';
import { planViewAdjustment } from './pasteView';

// The view of the Figma lab: 908 x 812 canvas units at zoom 1. The safe area is 1/16 inside it.
const view = { x: 0, y: 0, width: 800, height: 640 };

describe('view after a paste', () => {
	it('leaves the view alone when the content touches the safe area', () => {
		const content = { x: 300, y: 200, width: 100, height: 100 };
		expect(planViewAdjustment(content, view, 'covers-safe-area')).toEqual({ kind: 'none' });
		const barelyInside = { x: 40, y: 200, width: 100, height: 100 };
		expect(planViewAdjustment(barelyInside, view, 'covers-safe-area')).toEqual({ kind: 'none' });
	});

	it('pans just far enough to bring content from the margin or outside to the safe edge', () => {
		const inLeftMargin = { x: 10, y: 200, width: 30, height: 30 };
		expect(planViewAdjustment(inLeftMargin, view, 'covers-safe-area')).toEqual({
			kind: 'pan',
			shift: { x: -40, y: 0 }
		});
		const pastBottom = { x: 300, y: 700, width: 100, height: 100 };
		expect(planViewAdjustment(pastBottom, view, 'covers-safe-area')).toEqual({
			kind: 'pan',
			shift: { x: 0, y: 800 - 600 }
		});
	});

	it('zooms to the content only when it covers the whole safe area', () => {
		const covering = { x: -50, y: -50, width: 900, height: 740 };
		expect(planViewAdjustment(covering, view, 'covers-safe-area')).toEqual({
			kind: 'zoom-to-selection'
		});
		const wideStrip = { x: -1000, y: 200, width: 3000, height: 100 };
		expect(planViewAdjustment(wideStrip, view, 'covers-safe-area')).toEqual({ kind: 'none' });
	});

	it('paste here zooms when the content is larger than the safe area in either direction', () => {
		const wideStrip = { x: 0, y: 200, width: 760, height: 100 };
		expect(planViewAdjustment(wideStrip, view, 'larger-than-safe-area')).toEqual({
			kind: 'zoom-to-selection'
		});
		const small = { x: 300, y: 200, width: 100, height: 100 };
		expect(planViewAdjustment(small, view, 'larger-than-safe-area')).toEqual({ kind: 'none' });
	});

	it('pans just enough to bring all of a moved duplicate inside the safe area', () => {
		const hangingOut = { x: 600, y: 200, width: 200, height: 100 };
		expect(planViewAdjustment(hangingOut, view, 'covers-safe-area', 'overlap')).toEqual({
			kind: 'none'
		});
		expect(planViewAdjustment(hangingOut, view, 'covers-safe-area', 'just-enough')).toEqual({
			kind: 'pan',
			shift: { x: 800 - 750, y: 0 }
		});
		const beforeStart = { x: 20, y: 200, width: 200, height: 100 };
		expect(planViewAdjustment(beforeStart, view, 'covers-safe-area', 'just-enough')).toEqual({
			kind: 'pan',
			shift: { x: 20 - 50, y: 0 }
		});
	});

	it('always zooms into an empty destination', () => {
		const small = { x: 300, y: 200, width: 100, height: 100 };
		expect(planViewAdjustment(small, view, 'always')).toEqual({ kind: 'zoom-to-selection' });
	});
});
