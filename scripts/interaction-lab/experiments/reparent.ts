import type { Anchor, Experiment, Lab } from '../lab';
import { placeNode, selected } from './helpers';

// Frame spans x 0..400, y 300..600 (absolute). A starts left of it, vertically centred in it.
const FRAME = { left: 0, right: 400 };
const START = { x: -250, y: 400 };

/** Drags A rightwards across Frame; returns where its parent changed, in canvas coordinates. */
export async function reparentSweep(lab: Lab, grip: Anchor, modifiers: string[]): Promise<string> {
	await lab.resetToFixture();
	await placeNode(lab, 'A', START.x, START.y);
	await lab.setZoom(1, { x: 150, y: 450 });
	let gripOffset = 0;
	if (grip === 'l') gripOffset = 5;
	if (grip === 'r') gripOffset = -5;
	for (const name of modifiers) await lab.holdKey(name);
	await lab.press(await lab.nodePoint('A', grip, { x: gripOffset, y: 0 }));
	const changes: string[] = [];
	let parent = 'CDP lab';
	for (let step = 1; step <= 160; step += 1) {
		const sample = await lab.moveBy(5, 0);
		const node = selected(sample, 'A');
		if (!node || !node.absolute || !node.parent || !sample.pointerCanvas) continue;
		if (node.parent.name === parent) continue;
		parent = node.parent.name;
		const pointerX = Math.round(sample.pointerCanvas.x);
		const left = Math.round(node.absolute.x);
		changes.push(
			`→ ${parent} at pointer x ${pointerX}, A ${left}..${left + 100} (center ${left + 50}; Frame ${FRAME.left}..${FRAME.right})`
		);
		await lab.shot(`grip-${grip}${modifiers.join('-')}-into-${parent}`);
	}
	await lab.release(`grip-${grip}${modifiers.join('-')}-released`);
	for (const name of modifiers) await lab.releaseKey(name);
	if (changes.length === 0) return 'parent never changed';
	return changes.join('; ');
}

export const reparent: Experiment = {
	name: 'reparent-frame',
	question:
		'While dragging a node across a frame, when does the frame become its parent and when does it stop being it: pointer inside, node center, or overlap? (moving.md experiment 14)',
	async run(lab) {
		lab.result('grip near A right edge', await reparentSweep(lab, 'r', []));
		lab.result('grip near A left edge', await reparentSweep(lab, 'l', []));
	}
};
