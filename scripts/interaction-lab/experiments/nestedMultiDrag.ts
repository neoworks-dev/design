import type { Experiment, Lab, NodeState, Sample } from '../lab';

type SelectMethod = 'clicks' | 'api';

function names(selection: NodeState[]): string {
	if (selection.length === 0) return 'nothing';
	return selection.map((node) => node.name).join('+');
}

async function positions(lab: Lab, nodeNames: string[]): Promise<string> {
	const parts: string[] = [];
	for (const name of nodeNames) {
		const node = await lab.node(name);
		let parent = '?';
		if (node.parent) parent = node.parent.name;
		parts.push(`${name} ${node.x},${node.y} in ${parent}`);
	}
	return parts.join('; ');
}

async function selectPair(lab: Lab, pair: string[], method: SelectMethod): Promise<Sample> {
	await lab.resetToFixture();
	await lab.pause(800);
	if (method === 'api') {
		await lab.select(pair);
		return lab.sample('selected via api');
	}
	return lab.selectByClicking(pair);
}

interface PressPlan {
	/** Which of the pair is pressed to start the drag. */
	grab: string;
	/** Wait between the selecting click and the press; under ~500 ms it may read as a double-click. */
	wait: number;
}

/**
 * Selects both nodes, waits, presses 15 px inside the grabbed one's top-left corner (its body,
 * not a smart-selection handle) and drags 30 px right; reports the selection at each stage.
 */
async function dragPair(
	lab: Lab,
	pair: string[],
	method: SelectMethod,
	plan: PressPlan = { grab: pair[0], wait: 800 }
): Promise<void> {
	const prefix = `[${pair.join('+')}, ${method}, press ${plan.grab} after ${plan.wait} ms]`;
	const selected = await selectPair(lab, pair, method);
	lab.result(`${prefix} selected`, names(selected.selection));
	await lab.pause(plan.wait);
	const label = `${pair.join('-')}-${method}-${plan.grab}-${plan.wait}`.toLowerCase();
	const grabPoint = await lab.nodePoint(plan.grab, 'tl', { x: 15, y: 15 });
	const pressed = await lab.press(grabPoint, `${label}-pressed`);
	lab.result(`${prefix} after press`, names(pressed.selection));
	const moved = await lab.moveBy(30, 0, { steps: 6, shot: `${label}-dragged` });
	lab.result(`${prefix} while dragging 30px`, names(moved.selection));
	const released = await lab.release(`${label}-released`);
	lab.result(`${prefix} after release`, names(released.selection));
	lab.result(`${prefix} positions after`, await positions(lab, pair));
}

async function dragPairAtClick(lab: Lab, pair: string[]): Promise<void> {
	const prefix = `[${pair.join('+')}, clicks, press ${pair[1]} centre right after its Shift-click]`;
	await selectPair(lab, pair, 'clicks');
	await lab.pause(100);
	const pressed = await lab.press(await lab.nodePoint(pair[1]), 'press-at-shift-click');
	lab.result(`${prefix} after press`, names(pressed.selection));
	const moved = await lab.moveBy(30, 0, { steps: 6 });
	lab.result(`${prefix} while dragging 30px`, names(moved.selection));
	await lab.release();
	lab.result(`${prefix} positions after`, await positions(lab, pair));
}

export const nestedMultiDrag: Experiment = {
	name: 'nested-multi-drag',
	question:
		'With two children of the same frame selected (C+D in a plain frame, S1+S2 in auto layout), does pressing one and dragging move both, or does the selection collapse to the pressed one?',
	async run(lab) {
		for (const method of ['clicks', 'api'] as const) {
			await dragPair(lab, ['C', 'D'], method);
			await dragPair(lab, ['S1', 'S2'], method);
		}
		// Like a person: Shift-click the second node, then start dragging right away.
		for (const pair of [
			['C', 'D'],
			['S1', 'S2']
		]) {
			for (const grab of pair) {
				await dragPair(lab, pair, 'clicks', { grab, wait: 100 });
			}
		}
		// Same, pressing exactly where the Shift-click landed (the node's centre).
		await dragPairAtClick(lab, ['C', 'D']);
	}
};
