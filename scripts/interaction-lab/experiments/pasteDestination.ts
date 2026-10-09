import type { Experiment, Lab, SceneNode } from '../lab';
import { frame, node, observe, record, showView, viewSizeAt, type Box } from './pasteHelpers';

interface RectangleCase {
	label: string;
	rectangle: Box;
}

// A selected frame F (600x400 at the origin) holding a small child; R is copied from elsewhere.
const INTO_FILLED_FRAME: RectangleCase[] = [
	{
		label: 'R disjoint from F on both axes',
		rectangle: { x: 1000, y: 1000, width: 100, height: 80 }
	},
	{ label: 'R overlaps F in x only', rectangle: { x: 100, y: 1000, width: 100, height: 80 } },
	{ label: 'R overlaps F in y only', rectangle: { x: 1000, y: 100, width: 100, height: 80 } },
	{ label: 'R wider than F', rectangle: { x: 100, y: 1000, width: 800, height: 80 } },
	{ label: 'R taller than F', rectangle: { x: 1000, y: 100, width: 100, height: 500 } },
	{ label: 'R inside F', rectangle: { x: 100, y: 100, width: 100, height: 80 } },
	{
		label: 'R sticks out of F on the right',
		rectangle: { x: 550, y: 350, width: 100, height: 80 }
	},
	{ label: 'R left of F touching its edge', rectangle: { x: -100, y: 100, width: 100, height: 80 } }
];

function filledFrameScene(rectangle: Box): SceneNode[] {
	return [
		frame('F', 0, 0, 600, 400, [node('rectangle', 'K', 10, 10, 20, 20)]),
		node('rectangle', 'R', rectangle.x, rectangle.y, rectangle.width, rectangle.height)
	];
}

async function copyThenSelect(lab: Lab, copied: string, selected: string[]): Promise<void> {
	await lab.select([copied]);
	await lab.copy();
	if (selected.length === 0) await lab.tap('Escape');
	else await lab.select(selected);
}

export const pasteDestination: Experiment = {
	name: 'paste-destination',
	question:
		'Ctrl+V into a selected frame (filled or empty) and into an emptied page: where does the content land (kept, centred on one axis or both, at the frame origin, at the page origin), and how does the view react? (paste.md experiments 13, 14, 15)',
	async run(lab) {
		const full = await viewSizeAt(lab, 1);
		for (const entry of INTO_FILLED_FRAME) {
			await lab.resetToScene(filledFrameScene(entry.rectangle));
			await showView(lab, 0.25, { x: 500, y: 500 });
			await copyThenSelect(lab, 'R', ['F']);
			record(lab, `filled frame, ${entry.label}`, await observe(lab, () => lab.paste()));
		}

		await lab.resetToScene(filledFrameScene({ x: 350, y: 100, width: 100, height: 80 }));
		await showView(lab, 1, { x: 300 + full.width / 2, y: 200 });
		await copyThenSelect(lab, 'R', ['F']);
		record(
			lab,
			'filled frame, left half out of view, R in the visible half',
			await observe(lab, () => lab.paste())
		);

		await lab.resetToScene(filledFrameScene({ x: 100, y: 100, width: 100, height: 80 }));
		await showView(lab, 1, { x: 300 + full.width / 2, y: 200 });
		await copyThenSelect(lab, 'R', ['F']);
		record(
			lab,
			'filled frame, left half out of view, R in the hidden half',
			await observe(lab, () => lab.paste())
		);

		await lab.resetToScene(filledFrameScene({ x: 100, y: 100, width: 100, height: 80 }));
		await showView(lab, 1, { x: 300 + full.width / 2, y: 200 });
		await copyThenSelect(lab, 'F', ['F']);
		record(
			lab,
			'F copied with F selected, left half out of view',
			await observe(lab, () => lab.paste())
		);

		const emptyFrameScene = [
			frame('E', 300, 300, 300, 200),
			node('rectangle', 'R', 1000, 1000, 100, 80)
		];
		for (const [label, centre] of [
			['E in view', { x: 500, y: 500 }],
			['E out of view', { x: 3000, y: 3000 }]
		] as const) {
			await lab.resetToScene(emptyFrameScene);
			await showView(lab, 1, centre);
			await copyThenSelect(lab, 'R', ['E']);
			record(lab, `empty frame, ${label}`, await observe(lab, () => lab.paste()));
		}

		await lab.resetToScene([
			frame('E', 300, 300, 300, 200),
			node('rectangle', 'R', 350, 350, 100, 80)
		]);
		await showView(lab, 1, { x: 500, y: 500 });
		await copyThenSelect(lab, 'R', ['E']);
		record(lab, 'empty frame, R copied from inside it', await observe(lab, () => lab.paste()));

		await lab.resetToScene([
			frame('E', 300, 300, 300, 200),
			node('rectangle', 'R', 350, 350, 100, 80)
		]);
		await showView(lab, 1, { x: 500, y: 500 });
		await lab.select(['R']);
		await lab.cut();
		await lab.select(['E']);
		record(lab, 'empty frame, R cut from inside it', await observe(lab, () => lab.paste()));

		for (const [label, rectangle] of [
			['R small', { x: 500, y: 500, width: 100, height: 80 }],
			['R large', { x: 500, y: 500, width: 3000, height: 2000 }],
			['R tall', { x: 500, y: 500, width: 100, height: 3000 }]
		] as const) {
			await lab.resetToScene([
				node('rectangle', 'R', rectangle.x, rectangle.y, rectangle.width, rectangle.height)
			]);
			await showView(lab, 1, { x: 600, y: 600 });
			await lab.select(['R']);
			await lab.cut();
			record(lab, `empty page, ${label}`, await observe(lab, () => lab.paste()));
		}

		await lab.resetToScene([node('rectangle', 'R', 500, 500, 100, 80)]);
		await showView(lab, 1, { x: 600, y: 600 });
		await lab.select(['R']);
		await lab.cut();
		await showView(lab, 1, { x: 5000, y: 5000 });
		record(lab, 'empty page, R cut, view moved away', await observe(lab, () => lab.paste()));

		const farFrame = frame('F', 1000, 1000, 600, 400, [node('rectangle', 'K', 10, 10, 20, 20)]);
		await lab.resetToScene([farFrame, node('rectangle', 'R', 100, 100, 100, 80)]);
		await showView(lab, 0.5, { x: 800, y: 700 });
		await copyThenSelect(lab, 'R', ['F']);
		record(
			lab,
			'frame at 1000,1000, R copied from the page at 100,100',
			await observe(lab, () => lab.paste())
		);

		await lab.resetToScene([
			farFrame,
			frame('G', 0, 0, 600, 400, [node('rectangle', 'R', 50, 50, 100, 80)])
		]);
		await showView(lab, 0.5, { x: 800, y: 700 });
		await copyThenSelect(lab, 'R', ['F']);
		record(
			lab,
			'frame at 1000,1000, R copied from frame G at 0,0 (50,50 inside it)',
			await observe(lab, () => lab.paste())
		);

		await lab.resetToScene([
			frame('F', 1000, 1000, 600, 400, [node('rectangle', 'K', 10, 10, 20, 20)]),
			frame('G', 1000, 0, 600, 400, [node('rectangle', 'R', 50, 50, 100, 80)])
		]);
		await showView(lab, 0.5, { x: 1300, y: 700 });
		await copyThenSelect(lab, 'R', ['F']);
		record(
			lab,
			'frame at 1000,1000, R copied from frame G at 1000,0 (50,50 inside it)',
			await observe(lab, () => lab.paste())
		);

		for (const [label, view] of [
			['view on it', { x: 400, y: 275 }],
			['view moved away', { x: 5000, y: 5000 }]
		] as const) {
			await lab.resetToScene([frame('T', 300, 200, 200, 150)]);
			await showView(lab, 1, { x: 400, y: 275 });
			await lab.select(['T']);
			await lab.cut();
			await showView(lab, 1, view);
			record(lab, `empty page, frame cut, ${label}`, await observe(lab, () => lab.paste()));
		}
	}
};
