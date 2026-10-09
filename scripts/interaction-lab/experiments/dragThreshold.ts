import type { Experiment, Lab } from '../lab';
import { ISOLATED, placeNode } from './helpers';

// Longer than any double-click window, so repeated presses on A stay single presses.
const BETWEEN_PRESSES = 800;

// Single press on A, move straight right by `distance` screen px in one event, release.
async function dragOnce(lab: Lab, distance: number): Promise<number> {
	await placeNode(lab, 'A', ISOLATED.x, ISOLATED.y);
	await lab.tap('Escape');
	await lab.pause(BETWEEN_PRESSES);
	await lab.press(await lab.nodePoint('A'));
	await lab.moveBy(distance, 0);
	await lab.release();
	const node = await lab.node('A');
	return node.x - ISOLATED.x;
}

export const dragThreshold: Experiment = {
	name: 'drag-threshold',
	question:
		'How far must the pointer travel before a press on a node becomes a move, does the node then jump by the full pointer delta, and does moving back re-arm the threshold? (moving.md experiments 1–3)',
	async run(lab) {
		for (const zoom of [1, 0.25, 4]) {
			await lab.setZoom(zoom, { x: ISOLATED.x + 50, y: ISOLATED.y + 50 });
			for (const distance of [1, 2, 3, 4, 5, 6, 8]) {
				const x = await dragOnce(lab, distance);
				lab.result(`zoom ${zoom}: one ${distance}px move → ΔA.x`, x);
			}
		}

		await lab.setZoom(1, { x: ISOLATED.x + 50, y: ISOLATED.y + 50 });
		await placeNode(lab, 'A', ISOLATED.x, ISOLATED.y);
		await lab.tap('Escape');
		const start = await lab.nodePoint('A');
		await lab.pause(BETWEEN_PRESSES);
		await lab.press(start, 'pressed');
		for (let step = 1; step <= 8; step += 1) {
			const sample = await lab.moveBy(1, 0, { shot: step === 8 ? 'dragged-8px' : undefined });
			const node = sample.selection.find((candidate) => candidate.name === 'A');
			lab.result(`1px steps: after ${step}px → ΔA.x`, node ? node.x - ISOLATED.x : 'not selected');
		}
		const back = await lab.moveTo(start, { shot: 'back-at-press-point' });
		const backNode = back.selection.find((candidate) => candidate.name === 'A');
		lab.result(
			'back at the press point while held → ΔA.x',
			backNode ? backNode.x - ISOLATED.x : 'not selected'
		);
		await lab.moveBy(2, 0);
		const rearmed = await lab.node('A');
		lab.result('then 2px right again → ΔA.x', rearmed.x - ISOLATED.x);
		await lab.release('released');
	}
};
