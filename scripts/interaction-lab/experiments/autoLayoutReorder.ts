import type { Experiment, Lab } from '../lab';
import { selected } from './helpers';

// Stack children S1..S3 are 60 px wide with 10 px gaps from x 510; their centers are 540, 610, 680.
async function sweepTracking(
	lab: Lab,
	name: string,
	deltaX: number,
	deltaY: number,
	count: number,
	label: string
): Promise<string[]> {
	await lab.press(await lab.nodePoint(name));
	const changes: string[] = [];
	let last = '';
	for (let step = 1; step <= count; step += 1) {
		const sample = await lab.moveBy(deltaX, deltaY);
		const node = selected(sample, name);
		if (!node || !node.parent || !sample.pointerCanvas) continue;
		const state = `${node.parent.name}[${node.index}]`;
		if (state === last) continue;
		last = state;
		const pointer = `${Math.round(sample.pointerCanvas.x)},${Math.round(sample.pointerCanvas.y)}`;
		changes.push(`${state} at pointer ${pointer}`);
		await lab.shot(`${label}-${node.parent.name}-${node.index}`);
	}
	await lab.release(`${label}-released`);
	const after = await lab.node(name);
	let parentName = '?';
	if (after.parent) parentName = after.parent.name;
	changes.push(`after release: ${parentName}[${after.index}] at ${after.x},${after.y}`);
	return changes;
}

export const autoLayoutReorder: Experiment = {
	name: 'auto-layout-reorder',
	question:
		'Dragging inside a horizontal auto-layout frame: at which pointer positions does the child change index, is the order live during the drag, and how far out must it go to leave the stack? (moving.md experiment 15)',
	async run(lab) {
		await lab.setZoom(1, { x: 610, y: 340 });
		const along = await sweepTracking(lab, 'S1', 1, 0, 250, 'along');
		lab.result('S1 dragged right along the stack', along.join('; '));

		await lab.resetToFixture();
		await lab.setZoom(1, { x: 610, y: 340 });
		const up = await sweepTracking(lab, 'S2', 0, -1, 150, 'up');
		lab.result('S2 dragged straight up', up.join('; '));

		await lab.resetToFixture();
		await lab.setZoom(1, { x: 610, y: 340 });
		const down = await sweepTracking(lab, 'S2', 0, 1, 150, 'down');
		lab.result('S2 dragged straight down', down.join('; '));
	}
};
