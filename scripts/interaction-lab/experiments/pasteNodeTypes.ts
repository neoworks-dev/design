import type { Experiment, Lab, SceneNode } from '../lab';
import { classify, frame, node, observe, record, showView, type Box } from './pasteHelpers';

interface Subject {
	label: string;
	scene: SceneNode[];
	/** Name of the node to copy. */
	copied: string;
	original: Box;
}

const BOX: Box = { x: 0, y: 0, width: 200, height: 150 };

const SUBJECTS: Subject[] = [
	{ label: 'frame', scene: [frame('S', 0, 0, 200, 150)], copied: 'S', original: BOX },
	{
		label: 'rectangle',
		scene: [node('rectangle', 'S', 0, 0, 200, 150)],
		copied: 'S',
		original: BOX
	},
	{ label: 'text', scene: [node('text', 'S', 0, 0, 200, 150)], copied: 'S', original: BOX },
	{
		label: 'component',
		scene: [node('component', 'S', 0, 0, 200, 150)],
		copied: 'S',
		original: BOX
	},
	{
		label: 'group',
		scene: [
			{
				type: 'group',
				name: 'S',
				x: 0,
				y: 0,
				width: 0,
				height: 0,
				children: [
					node('rectangle', 'G1', 0, 0, 100, 150),
					node('rectangle', 'G2', 100, 0, 100, 150)
				]
			}
		],
		copied: 'S',
		original: BOX
	},
	{
		label: 'rectangle inside a frame',
		scene: [frame('P', 0, 0, 600, 400, [node('rectangle', 'S', 50, 50, 200, 150)])],
		copied: 'S',
		original: { x: 50, y: 50, width: 200, height: 150 }
	},
	{
		label: 'frame inside a frame',
		scene: [frame('P', 0, 0, 600, 400, [frame('S', 50, 50, 200, 150)])],
		copied: 'S',
		original: { x: 50, y: 50, width: 200, height: 150 }
	}
];

async function prepare(lab: Lab, subject: Subject): Promise<Box> {
	await lab.resetToScene(subject.scene);
	return showView(lab, 1, { x: 200, y: 150 });
}

export const pasteNodeTypes: Experiment = {
	name: 'paste-node-types',
	question:
		'Ctrl+V of one node with that node selected, and with nothing selected: which node types (frame, rectangle, text, component, group, nested) are pushed to the right of the original and which land on top of it? (paste.md experiment 6)',
	async run(lab) {
		for (const subject of SUBJECTS) {
			for (const selection of ['selected', 'nothing selected']) {
				const view = await prepare(lab, subject);
				await lab.select([subject.copied]);
				await lab.copy();
				if (selection === 'nothing selected') await lab.tap('Escape');
				const observation = await observe(lab, () => lab.paste());
				const label = `${subject.label}, ${selection}`;
				record(lab, label, observation);
				const root = observation.created.find((entry) => entry.name === subject.copied);
				if (root) lab.result(`${label}: placement`, classify(root, subject.original, view));
			}
		}
	}
};
