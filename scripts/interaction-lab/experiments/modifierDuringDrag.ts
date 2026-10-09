import type { Experiment } from '../lab';
import { measureSnap } from './snapDistance';
import { reparentSweep } from './reparent';

export const modifierDuringDrag: Experiment = {
	name: 'control-during-drag',
	question:
		'What does holding Control during a move change: snapping, reparenting into frames, or both? (moving.md experiment 8)',
	async run(lab) {
		const snap = await measureSnap(lab, 1, ['Control']);
		lab.result('Control held: approaching edge', snap.forward);
		lab.result('Control held: leaving edge', snap.backward);
		const entering = await reparentSweep(lab, 'r', ['Control']);
		lab.result('Control held: drag across Frame', entering);
	}
};
