import type { Experiment, Lab } from '../lab';

function names(selection: Array<{ name: string }>): string {
	if (selection.length === 0) return 'nothing';
	return selection.map((node) => node.name).join('+');
}

async function positions(lab: Lab): Promise<string> {
	const a = await lab.node('A');
	const b = await lab.node('B');
	return `A.x=${a.x} B.x=${b.x}`;
}

type SelectMethod = 'api' | 'clicks';

async function selectAB(lab: Lab, method: SelectMethod): Promise<void> {
	await lab.resetToFixture();
	if (method === 'api') {
		await lab.select(['A', 'B']);
		return;
	}
	await lab.selectByClicking(['A', 'B']);
}

// A's center is the smart-selection reorder handle when A and B are evenly spaced; 20 px in from
// the top-left corner is plain node body.
type Grip = 'center' | 'body';

async function gripPoint(lab: Lab, grip: Grip): Promise<{ x: number; y: number }> {
	if (grip === 'center') return lab.nodePoint('A');
	return lab.nodePoint('A', 'tl', { x: 20, y: 20 });
}

async function runWith(lab: Lab, method: SelectMethod, grip: Grip): Promise<void> {
	const prefix = `[${method}, ${grip}] `;
	const label = `${method}-${grip}`;
	await selectAB(lab, method);
	const point = await gripPoint(lab, grip);
	lab.result(
		`${prefix}press on A`,
		names((await lab.press(point, `${label}-pressed-on-a`)).selection)
	);
	lab.result(
		`${prefix}release without moving`,
		names((await lab.release(`${label}-released-on-a`)).selection)
	);

	await selectAB(lab, method);
	await lab.press(point);
	const dragged = await lab.moveBy(30, 0, { steps: 6, shot: `${label}-dragged-30` });
	lab.result(
		`${prefix}drag 30px from A, while held`,
		`${names(dragged.selection)}; ${await positions(lab)}`
	);
	const released = await lab.release(`${label}-dragged-released`);
	lab.result(`${prefix}after release`, `${names(released.selection)}; ${await positions(lab)}`);

	await selectAB(lab, method);
	await lab.holdKey('Shift');
	lab.result(`${prefix}Shift+press on selected A`, names((await lab.press(point)).selection));
	lab.result(
		`${prefix}Shift+release`,
		names((await lab.release(`${label}-shift-click-a`)).selection)
	);
	await lab.releaseKey('Shift');
}

export const multiSelectionClick: Experiment = {
	name: 'multi-selection-click',
	question:
		'With A and B selected, what does a press / release / drag on A do to the selection, and what does Shift-click on a selected node do? Pressing the center of A hits the smart-selection handle (A and B are evenly spaced), so A is pressed both there and on its body; the selection is made via real clicks and via the plugin API. (moving.md experiment 18, interactions.md §3)',
	async run(lab) {
		await runWith(lab, 'clicks', 'body');
		await runWith(lab, 'clicks', 'center');
		await runWith(lab, 'api', 'body');
		await lab.resetToFixture();
		await lab.holdKey('Shift');
		await lab.click(await lab.nodePoint('A'));
		const shiftAdd = await lab.click(await lab.nodePoint('B'));
		lab.result('Shift-click A then B from empty selection', names(shiftAdd.selection));
		await lab.releaseKey('Shift');
	}
};
