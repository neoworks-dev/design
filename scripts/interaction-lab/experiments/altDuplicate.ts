import type { Experiment, Lab } from '../lab';
import { ISOLATED, isolateA, offsetOf, pageChildCount } from './helpers';

// Node ids differ between Figma and the app, so each id is reported as a stable role instead:
// "original" for A, "copy 1", "copy 2", ... in order of first appearance.
class NodeRoles {
	private readonly roles = new Map<string, string>();

	constructor(originalId: string) {
		this.roles.set(originalId, 'original');
	}

	describe(ids: string[]): string {
		if (ids.length === 0) return 'nothing';
		return ids.map((id) => this.roleOf(id)).join(',');
	}

	private roleOf(id: string): string {
		const known = this.roles.get(id);
		if (known) return known;
		const role = `copy ${this.roles.size}`;
		this.roles.set(id, role);
		return role;
	}
}

let roles = new NodeRoles('');

async function describeStage(lab: Lab, label: string, sampleIds: string[]): Promise<void> {
	const count = await pageChildCount(lab);
	lab.result(label, `page children ${count}, selection ${roles.describe(sampleIds)}`);
}

export const altDuplicate: Experiment = {
	name: 'alt-duplicate',
	question:
		'Alt-drag duplicate: when is the copy created (press, threshold, release), which node moves, and what happens when Alt is pressed or released mid-drag? (moving.md experiment 6)',
	async run(lab) {
		await isolateA(lab);
		const original = await lab.node('A');
		roles = new NodeRoles(original.id);
		lab.note('the fixture has 4 page children (A, B, Frame, Stack)');
		await lab.holdKey('Alt');
		let sample = await lab.press(await lab.nodePoint('A'), 'alt-pressed');
		await describeStage(
			lab,
			'Alt held, pressed',
			sample.selection.map((node) => node.id)
		);
		sample = await lab.moveBy(3, 0, { steps: 3 });
		await describeStage(
			lab,
			'Alt held, moved 3px (below threshold)',
			sample.selection.map((node) => node.id)
		);
		sample = await lab.moveBy(37, 0, { steps: 6, shot: 'alt-dragged-40' });
		await describeStage(
			lab,
			'Alt held, moved 40px',
			sample.selection.map((node) => node.id)
		);
		lab.result('selection position after 40px', offsetOf(sample, 'A', ISOLATED));
		sample = await lab.releaseKey('Alt', 'alt-released-mid-drag');
		await describeStage(
			lab,
			'Alt released mid-drag',
			sample.selection.map((node) => node.id)
		);
		sample = await lab.holdKey('Alt', 'alt-pressed-again');
		await describeStage(
			lab,
			'Alt pressed again mid-drag',
			sample.selection.map((node) => node.id)
		);
		sample = await lab.release('released');
		await describeStage(
			lab,
			'mouse up',
			sample.selection.map((node) => node.id)
		);
		await lab.releaseKey('Alt');
		const after = await lab.node('A');
		lab.result(
			'first node named "A" after',
			`${roles.describe([after.id])} at ${after.x - ISOLATED.x},${after.y - ISOLATED.y}`
		);

		await isolateA(lab);
		await lab.press(await lab.nodePoint('A'));
		sample = await lab.moveBy(40, 0, { steps: 8 });
		sample = await lab.holdKey('Alt', 'alt-pressed-after-drag-start');
		await describeStage(
			lab,
			'plain drag, then Alt pressed',
			sample.selection.map((node) => node.id)
		);
		sample = await lab.moveBy(20, 0, { steps: 4 });
		await describeStage(
			lab,
			'…moved 20px further',
			sample.selection.map((node) => node.id)
		);
		await lab.release('released-2');
		await lab.releaseKey('Alt');
		await describeStage(
			lab,
			'mouse up',
			(await lab.sample('after')).selection.map((node) => node.id)
		);
	}
};
