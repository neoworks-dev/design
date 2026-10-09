import type { Experiment, Lab } from '../lab';
import {
	classify,
	frame,
	node,
	observe,
	record,
	showView,
	viewSizeAt,
	type Box
} from './pasteHelpers';

const ORIGINAL: Box = { x: 0, y: 0, width: 400, height: 300 };

async function freshView(lab: Lab, scene: ReturnType<typeof frame>[], zoom = 1): Promise<Box> {
	await lab.resetToScene(scene);
	return showView(lab, zoom, { x: 200, y: 150 });
}

export const pasteNextTo: Experiment = {
	name: 'paste-next-to',
	question:
		'Ctrl+V of a top-level frame: when does the copy land next to the original (right edge + 40, repeated) and when on top of it? Selected vs Escape, repeated pastes, a different frame selected (other size, same size), two frames copied. (paste.md experiments 1, 2, 3, 7)',
	async run(lab) {
		let view = await freshView(lab, [frame('A', 0, 0, 400, 300)]);
		await lab.select(['A']);
		await lab.copy();
		for (const step of [1, 2, 3]) {
			const observation = await observe(lab, () => lab.paste());
			record(lab, `A selected, paste ${step}`, observation);
			const [copy] = observation.created;
			if (copy) lab.result(`A selected, paste ${step}: placement`, classify(copy, ORIGINAL, view));
		}

		view = await freshView(lab, [frame('A', 0, 0, 400, 300)]);
		await lab.select(['A']);
		await lab.copy();
		const escape = await lab.tap('Escape');
		lab.result('selection after Escape', String(escape.selection.length));
		const afterEscape = await observe(lab, () => lab.paste());
		record(lab, 'nothing selected', afterEscape);
		const [escaped] = afterEscape.created;
		if (escaped) lab.result('nothing selected: placement', classify(escaped, ORIGINAL, view));
		const second = await observe(lab, () => lab.paste());
		record(lab, 'nothing selected, paste again (copy selected)', second);

		// Only 100 units of "Different" are in view, wherever the canvas edge is.
		const half = await viewSizeAt(lab, 0.5);
		const differentX = 200 + half.width / 2 - 100;
		const others = [
			frame('A', 0, 0, 400, 300),
			frame('Different', differentX, 0, 500, 200),
			frame('Same size', 1000, 500, 400, 300)
		];
		for (const name of ['Different', 'Same size']) {
			view = await freshView(lab, others, 0.5);
			await lab.select(['A']);
			await lab.copy();
			await lab.select([name]);
			const observation = await observe(lab, () => lab.paste());
			record(lab, `A copied, ${name} selected`, observation, {
				x: name === 'Different' ? differentX : 0,
				y: 0
			});
		}

		const occupied = [frame('A', 0, 0, 400, 300), frame('Occupant', 440, 0, 200, 300)];
		view = await freshView(lab, occupied, 0.5);
		await lab.select(['A']);
		await lab.copy();
		const pushed = await observe(lab, () => lab.paste());
		record(lab, 'slot at 440 taken by a 200 wide frame', pushed);

		const pair = [frame('A', 0, 0, 400, 300), frame('B', 500, 0, 200, 300)];
		view = await freshView(lab, pair, 0.5);
		await lab.select(['A', 'B']);
		await lab.copy();
		const both = await observe(lab, () => lab.paste());
		record(lab, 'A and B copied, both selected', both);
		await lab.tap('Escape');
		const bothAgain = await observe(lab, () => lab.paste());
		record(lab, 'A and B copied, nothing selected', bothAgain);

		const lone = [node('rectangle', 'Filler', 5000, 5000, 10, 10), frame('A', 0, 0, 400, 300)];
		view = await freshView(lab, lone, 1);
		await lab.select(['A']);
		await lab.copy();
		await lab.select(['Filler']);
		const elsewhere = await observe(lab, () => lab.paste());
		record(lab, 'A copied, an unrelated rectangle selected', elsewhere);
	}
};
