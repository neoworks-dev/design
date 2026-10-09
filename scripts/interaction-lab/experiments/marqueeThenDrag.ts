import type { Experiment, Lab, NodeState } from '../lab';

// Frame spans 0..400 × 300..600 with children C (40,340 80×80) and D. D is moved out of line with
// C first: equal-size children in a row make Figma treat them as a smart selection, whose centre
// handles reorder instead of move (the reported Menu overlay has overlapping children instead).
const FRAME = { left: 0, top: 300, right: 400, bottom: 600 };

function names(selection: NodeState[]): string {
	if (selection.length === 0) return 'nothing';
	return selection.map((node) => node.name).join('+');
}

async function positions(lab: Lab): Promise<string> {
	const frame = await lab.node('Frame');
	const child = await lab.node('C');
	return `Frame ${frame.x},${frame.y}; C ${child.x},${child.y} in ${child.parent ? child.parent.name : '?'}`;
}

/** Marquee from outside the top-right corner to outside the bottom-left, containing Frame. */
async function marqueeAroundFrame(lab: Lab): Promise<string> {
	await lab.resetToFixture();
	await lab.placeNode('D', 230, 150);
	await lab.pause(800);
	await lab.press(await lab.canvasPoint(FRAME.right + 30, FRAME.top - 30));
	await lab.moveTo(await lab.canvasPoint(FRAME.left - 30, FRAME.bottom + 30), {
		steps: 12,
		shot: 'marquee'
	});
	const released = await lab.release('marquee-released');
	return names(released.selection);
}

async function marqueeThenDragFrom(
	lab: Lab,
	label: string,
	grabX: number,
	grabY: number
): Promise<void> {
	lab.result(`[${label}] marquee around Frame selects`, await marqueeAroundFrame(lab));
	await lab.pause(800);
	const pressed = await lab.press(await lab.canvasPoint(grabX, grabY), `${label}-pressed`);
	lab.result(`[${label}] after press`, names(pressed.selection));
	const moved = await lab.moveBy(40, 0, { steps: 8, shot: `${label}-dragging` });
	lab.result(`[${label}] while dragging 40px`, names(moved.selection));
	const released = await lab.release(`${label}-released`);
	lab.result(`[${label}] after release`, names(released.selection));
	lab.result(`[${label}] positions after`, await positions(lab));
}

export const marqueeThenDrag: Experiment = {
	name: 'marquee-then-drag',
	question:
		'Marquee-select a whole frame (top-right to bottom-left, containing it), then drag from its middle: does the frame move, or the child under the pointer? (reported with the Menu overlay setup)',
	async run(lab) {
		await marqueeThenDragFrom(lab, 'press on empty frame middle', 200, 500);
		await marqueeThenDragFrom(lab, 'press on child C', 55, 355);
	}
};
