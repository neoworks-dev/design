import type { Experiment, Lab } from '../lab';
import { ISOLATED, isolateA, placeNode } from './helpers';

/** A fresh fixture with A isolated and selected, so no step inherits an earlier one's edits. */
async function freshSelectedA(lab: Lab, zoom = 1): Promise<void> {
	await lab.resetToFixture();
	await isolateA(lab, zoom);
	await lab.select(['A']);
}

/** Position delta and resulting size of A after one chord, from a fresh fixture. */
async function effectOf(lab: Lab, chord: string, zoom = 1): Promise<string> {
	await freshSelectedA(lab, zoom);
	await lab.tap(chord);
	const after = await lab.node('A');
	return `Δ${after.x - ISOLATED.x},${after.y - ISOLATED.y} size ${after.width}×${after.height}`;
}

// Plugin-API edits share Figma's undo stack, so a single Ctrl+Z can't tell grouping apart from
// spill-over; the x after each Ctrl+Z can (3 → 2 → 1 → 0 means one step each).
async function undoTrail(lab: Lab, pause: number): Promise<string> {
	await freshSelectedA(lab);
	await lab.commitUndo();
	for (let tap = 0; tap < 3; tap += 1) {
		await lab.tap('ArrowRight');
		await new Promise((resolve) => setTimeout(resolve, pause));
	}
	let offset = (await lab.node('A')).x - ISOLATED.x;
	const trail = [String(offset)];
	// Stops at the start position: undoing further reaches the lab's own setup edits.
	for (let undo = 0; undo < 4 && offset > 0; undo += 1) {
		await lab.tap('Control+z');
		offset = (await lab.node('A')).x - ISOLATED.x;
		trail.push(String(offset));
	}
	return `Δx ${trail.join(' → ')}`;
}

export const nudge: Experiment = {
	name: 'nudge',
	question:
		'Arrow-key nudge: step sizes with each modifier, fractional positions, zoom dependence and undo coalescing. (moving.md experiment 16)',
	async run(lab) {
		for (const chord of [
			'ArrowRight',
			'ArrowDown',
			'Shift+ArrowRight',
			'Alt+ArrowRight',
			'Control+ArrowRight',
			'Control+Shift+ArrowRight'
		]) {
			lab.result(`${chord} →`, await effectOf(lab, chord));
		}
		lab.result('ArrowRight at 400 % →', await effectOf(lab, 'ArrowRight', 4));
		lab.result('ArrowRight at 25 % →', await effectOf(lab, 'ArrowRight', 0.25));

		await freshSelectedA(lab);
		await placeNode(lab, 'A', ISOLATED.x + 0.5, ISOLATED.y + 0.25);
		await lab.tap('ArrowRight');
		const fractional = await lab.node('A');
		lab.result(
			'from x+0.5,y+0.25, ArrowRight → position',
			`${fractional.x - ISOLATED.x},${fractional.y - ISOLATED.y}`
		);

		for (const pause of [50, 300, 1000, 2000]) {
			lab.result(
				`3 × ArrowRight ${pause} ms apart, then Ctrl+Z until back`,
				await undoTrail(lab, pause)
			);
		}
	}
};
