import type { Experiment } from '../lab';
import { ISOLATED, isolateA, offsetOf, pageChildCount } from './helpers';

export const escapeAndUndo: Experiment = {
	name: 'escape-and-undo',
	question:
		'Does Escape mid-drag restore the original position (and drop an Alt copy)? Is a multi-step drag one undo step? (moving.md experiment 7)',
	async run(lab) {
		await isolateA(lab);
		await lab.press(await lab.nodePoint('A'));
		await lab.moveBy(60, 30, { steps: 10 });
		lab.result(
			'Escape with button held',
			offsetOf(await lab.tap('Escape', 'escape-mid-drag'), 'A', ISOLATED)
		);
		lab.result(
			'pointer moved further after Escape',
			offsetOf(await lab.moveBy(20, 0, { steps: 4 }), 'A', ISOLATED)
		);
		await lab.release('released-after-escape');
		const afterEscape = await lab.node('A');
		lab.result('A after release', `${afterEscape.x - ISOLATED.x},${afterEscape.y - ISOLATED.y}`);

		await isolateA(lab);
		await lab.holdKey('Alt');
		await lab.press(await lab.nodePoint('A'));
		await lab.moveBy(60, 0, { steps: 10 });
		lab.result('Alt-drag: page children before Escape', await pageChildCount(lab));
		await lab.tap('Escape', 'escape-alt-drag');
		lab.result('Alt-drag: page children after Escape', await pageChildCount(lab));
		await lab.release();
		await lab.releaseKey('Alt');
		lab.result('Alt-drag: page children after release', await pageChildCount(lab));

		await isolateA(lab);
		await lab.press(await lab.nodePoint('A'));
		await lab.moveBy(80, 0, { steps: 16 });
		await lab.release();
		await lab.press(await lab.nodePoint('A'));
		await lab.moveBy(0, 50, { steps: 10 });
		await lab.release('two-drags-done');
		const moved = await lab.node('A');
		lab.result('after two drags', `${moved.x - ISOLATED.x},${moved.y - ISOLATED.y}`);
		await lab.tap('Control+z', 'undo-1');
		const undoOnce = await lab.node('A');
		lab.result('after one Ctrl+Z', `${undoOnce.x - ISOLATED.x},${undoOnce.y - ISOLATED.y}`);
		await lab.tap('Control+z', 'undo-2');
		const undoTwice = await lab.node('A');
		lab.result('after two Ctrl+Z', `${undoTwice.x - ISOLATED.x},${undoTwice.y - ISOLATED.y}`);
	}
};
