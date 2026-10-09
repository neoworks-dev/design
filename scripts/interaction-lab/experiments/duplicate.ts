import type { Experiment, Lab, SceneNode } from '../lab';
import {
	classify,
	describeSelection,
	describeView,
	frame,
	node,
	observe,
	record,
	showView,
	viewSizeAt,
	type Box
} from './pasteHelpers';

const BOX: Box = { x: 0, y: 0, width: 200, height: 150 };

interface Subject {
	label: string;
	scene: SceneNode[];
	selected: string[];
	original: Box;
}

const GROUP: SceneNode = {
	type: 'group',
	name: 'S',
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	children: [node('rectangle', 'G1', 0, 0, 100, 150), node('rectangle', 'G2', 100, 0, 100, 150)]
};

const SUBJECTS: Subject[] = [
	{ label: 'frame', scene: [frame('S', 0, 0, 200, 150)], selected: ['S'], original: BOX },
	{
		label: 'rectangle',
		scene: [node('rectangle', 'S', 0, 0, 200, 150)],
		selected: ['S'],
		original: BOX
	},
	{ label: 'text', scene: [node('text', 'S', 0, 0, 200, 150)], selected: ['S'], original: BOX },
	{
		label: 'component',
		scene: [node('component', 'S', 0, 0, 200, 150)],
		selected: ['S'],
		original: BOX
	},
	{ label: 'group', scene: [GROUP], selected: ['S'], original: BOX },
	{
		label: 'rotated frame',
		scene: [{ ...frame('S', 0, 0, 200, 150), rotation: 10 }],
		selected: ['S'],
		original: BOX
	},
	{
		label: 'two frames',
		scene: [frame('S', 0, 0, 200, 150), frame('T', 300, 0, 100, 150)],
		selected: ['S', 'T'],
		original: BOX
	},
	{
		label: 'rectangle inside a frame',
		scene: [frame('P', 0, 0, 600, 400, [node('rectangle', 'S', 50, 50, 200, 150)])],
		selected: ['S'],
		original: { x: 50, y: 50, width: 200, height: 150 }
	},
	{
		label: 'frame inside a frame',
		scene: [frame('P', 0, 0, 600, 400, [frame('S', 50, 50, 200, 150)])],
		selected: ['S'],
		original: { x: 50, y: 50, width: 200, height: 150 }
	}
];

async function show(lab: Lab, scene: SceneNode[], zoom = 1): Promise<Box> {
	await lab.resetToScene(scene);
	return showView(lab, zoom, { x: 200, y: 150 });
}

export const duplicate: Experiment = {
	name: 'duplicate',
	question:
		'Ctrl+D: which node types are pushed to the right of the original (gap 40) and which duplicate in place (frame, rectangle, text, component, group, rotated, several selected, nested)? Repeated duplicates, an occupied slot, an original out of view, and the view afterwards. (paste.md experiments 8, 9, 10, 11, 12)',
	async run(lab) {
		for (const subject of SUBJECTS) {
			const view = await show(lab, subject.scene);
			const original = (await lab.node(subject.selected[0])).absolute;
			await lab.select(subject.selected);
			const observation = await observe(lab, () => lab.duplicate());
			record(lab, `${subject.label}`, observation);
			const root = observation.created.find((entry) => entry.name === subject.selected[0]);
			if (root)
				lab.result(
					`${subject.label}: placement`,
					classify(root, original || subject.original, view)
				);
		}

		await show(lab, [frame('S', 0, 0, 200, 150)]);
		await lab.select(['S']);
		for (let step = 1; step <= 5; step += 1) {
			const observation = await observe(lab, () => lab.duplicate());
			record(lab, `frame, duplicate ${step} (copy stays selected)`, observation);
		}

		await show(lab, [frame('S', 0, 0, 200, 150)]);
		await lab.select(['S']);
		await lab.duplicate();
		await lab.select(['S']);
		record(
			lab,
			'frame, original selected again, second duplicate',
			await observe(lab, () => lab.duplicate())
		);

		await show(lab, [frame('S', 0, 0, 200, 150), frame('X', 240, 0, 300, 150)]);
		await lab.select(['S']);
		record(
			lab,
			'frame, slot at 240 taken by a 300 wide frame',
			await observe(lab, () => lab.duplicate())
		);

		const size = await viewSizeAt(lab, 1);
		for (const gap of [-0.05, -0.01, 0.01, 0.05, 1]) {
			await lab.resetToScene([frame('S', 0, 0, 200, 150)]);
			const centre = { x: 200 + gap * size.width + size.width / 2, y: 75 };
			const view = await showView(lab, 1, centre);
			await lab.select(['S']);
			const observation = await observe(lab, () => lab.duplicate());
			const label = `frame, view starts ${gap} view widths right of the frame`;
			lab.result(`${label}: selection`, describeSelection(observation));
			lab.result(`${label}: view`, describeView(observation));
			const [copy] = observation.created;
			if (copy) lab.result(`${label}: placement`, classify(copy, BOX, view));
		}
		await lab.resetToScene([frame('S', 0, 0, 200, 150)]);
		const view = await showView(lab, 1, { x: 100, y: 75 + 1.5 * size.height });
		await lab.select(['S']);
		const below = await observe(lab, () => lab.duplicate());
		const [copy] = below.created;
		lab.result('frame, view starts 1 view height below the frame: view', describeView(below));
		if (copy)
			lab.result(
				'frame, view starts 1 view height below the frame: placement',
				classify(copy, BOX, view)
			);

		for (const subject of [SUBJECTS[1], SUBJECTS[4], SUBJECTS[8]]) {
			await lab.resetToScene(subject.scene);
			const view = await showView(lab, 1, { x: 3000, y: 3000 });
			await lab.select(subject.selected);
			const observation = await observe(lab, () => lab.duplicate());
			const label = `${subject.label}, original out of view`;
			record(lab, label, observation);
			const root = observation.created.find((entry) => entry.name === subject.selected[0]);
			if (root) lab.result(`${label}: placement`, classify(root, subject.original, view));
		}
	}
};
