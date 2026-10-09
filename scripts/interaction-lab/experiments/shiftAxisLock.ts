import type { Experiment } from '../lab';
import { ISOLATED, isolateA, offsetOf } from './helpers';

export const shiftAxisLock: Experiment = {
	name: 'shift-axis-lock',
	question:
		'What does Shift constrain during a move: which axes (incl. 45°), decided by what, and does pressing/releasing Shift mid-drag apply immediately? (moving.md experiment 5)',
	async run(lab) {
		await isolateA(lab);
		await lab.press(await lab.nodePoint('A'));
		lab.result(
			'free move +40,+10',
			offsetOf(await lab.moveBy(40, 10, { steps: 4 }), 'A', ISOLATED)
		);
		lab.result(
			'Shift pressed mid-drag',
			offsetOf(await lab.holdKey('Shift', 'shift-pressed'), 'A', ISOLATED)
		);
		lab.result(
			'pointer now at +40,+35',
			offsetOf(await lab.moveBy(0, 25, { steps: 5 }), 'A', ISOLATED)
		);
		lab.result(
			'pointer now at +40,+60',
			offsetOf(
				await lab.moveBy(0, 25, { steps: 5, shot: 'shift-vertical-dominant' }),
				'A',
				ISOLATED
			)
		);
		lab.result(
			'pointer now at +60,+60 (45°)',
			offsetOf(await lab.moveBy(20, 0, { steps: 4, shot: 'shift-diagonal' }), 'A', ISOLATED)
		);
		lab.result('pointer now at +61,+60', offsetOf(await lab.moveBy(1, 0), 'A', ISOLATED));
		lab.result(
			'pointer now at +70,+30',
			offsetOf(await lab.moveBy(9, -30, { steps: 6 }), 'A', ISOLATED)
		);
		lab.result(
			'Shift released mid-drag',
			offsetOf(await lab.releaseKey('Shift', 'shift-released'), 'A', ISOLATED)
		);
		lab.result('after mouse up', offsetOf(await lab.release(), 'A', ISOLATED));

		await isolateA(lab);
		await lab.holdKey('Shift');
		await lab.press(await lab.nodePoint('A'));
		lab.result(
			'Shift held before press, move +3,+30',
			offsetOf(await lab.moveBy(3, 30, { steps: 6 }), 'A', ISOLATED)
		);
		lab.result(
			'then +3,+30 → +30,+30',
			offsetOf(await lab.moveBy(27, 0, { steps: 6 }), 'A', ISOLATED)
		);
		await lab.release();
		await lab.releaseKey('Shift');
	}
};
