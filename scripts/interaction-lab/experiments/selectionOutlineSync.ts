import type { Experiment, Lab, Rgb } from '../lab';
import { ISOLATED, isolateA } from './helpers';

// A's fill in the fixture (0.95, 0.3, 0.3) as 8-bit sRGB.
const A_FILL: Rgb = { r: 242, g: 77, b: 77 };

/**
 * Records where the outline sits relative to A, twice: right after the input (no frame waited
 * for, catching a stale overlay frame) and once the page has painted a few frames.
 */
async function check(lab: Lab, label: string, pointerFree = true): Promise<void> {
	// The cursor glyph is selection blue in Figma; park the pointer on empty canvas first.
	if (pointerFree) await lab.hover(await lab.canvasPoint(ISOLATED.x - 600, ISOLATED.y - 600));
	const immediate = await lab.outlineAlignment('A', A_FILL);
	await lab.settle(4);
	const settled = await lab.outlineAlignment('A', A_FILL);
	lab.result(`${label}: immediately`, immediate);
	lab.result(`${label}: settled`, settled);
	if (immediate !== 'aligned' || settled !== 'aligned') {
		await lab.shot(`${label.replace(/[^a-z0-9]+/gi, '-')}-outline`);
	}
}

export const selectionOutlineSync: Experiment = {
	name: 'selection-outline-sync',
	question:
		'Does the selection outline stay on the selected node through select, drag, release, nudge, undo, redo, zoom, wheel pan and Alt-duplicate? (pixel check of outline vs fill)',
	async run(lab) {
		await isolateA(lab);
		await lab.pause(800);
		await lab.click(await lab.nodePoint('A'));
		await check(lab, 'clicked A');

		await lab.pause(800);
		await lab.press(await lab.nodePoint('A', 'tl', { x: 20, y: 20 }));
		await lab.moveBy(40, 20, { steps: 8 });
		await check(lab, 'mid-drag (+40,+20)', false);
		await lab.release();
		await check(lab, 'after drag release');

		for (let tap = 0; tap < 3; tap += 1) await lab.tap('ArrowRight');
		await check(lab, 'after 3 × ArrowRight');
		await lab.tap('Control+z');
		await check(lab, 'after Ctrl+Z');
		await lab.tap('Control+Shift+z');
		await check(lab, 'after Ctrl+Shift+Z');

		await lab.setZoom(2, { x: ISOLATED.x + 60, y: ISOLATED.y + 60 });
		await check(lab, 'after zoom to 200 %');
		await lab.hover(await lab.canvasPoint(ISOLATED.x - 100, ISOLATED.y - 100));
		await lab.wheel(0, 120);
		await check(lab, 'after wheel pan');

		await lab.setZoom(1, { x: ISOLATED.x + 50, y: ISOLATED.y + 50 });
		await lab.pause(800);
		await lab.holdKey('Alt');
		await lab.press(await lab.nodePoint('A', 'tl', { x: 20, y: 20 }));
		// Far enough that the copy stays outside the area measured around the original.
		await lab.moveBy(0, 450, { steps: 12 });
		await lab.release();
		await lab.releaseKey('Alt');
		await check(lab, 'after Alt-drag duplicate (original A)');
	}
};
