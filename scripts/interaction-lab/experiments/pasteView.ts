import type { Experiment, Lab } from '../lab';
import {
	centreOf,
	describeView,
	node,
	observe,
	showView,
	viewSizeAt,
	type Box
} from './pasteHelpers';

interface ViewCase {
	label: string;
	/** The original, in fractions of the view: x and y of the left/top edge, width and height. */
	box: (view: Box) => Box;
}

/** A box of 4 % of the view in width and 5 % in height at `x`, `y`. */
function small(view: Box, x: number, y: number): Box {
	return { x, y, width: 0.04 * view.width, height: 0.05 * view.height };
}

function around(width: number, height: number): ViewCase['box'] {
	return (view) => {
		const centre = centreOf(view);
		return {
			x: centre.x - (width * view.width) / 2,
			y: centre.y - (height * view.height) / 2,
			width: width * view.width,
			height: height * view.height
		};
	};
}

const CASES: ViewCase[] = [
	{ label: '0.5 x 0.5 view in the middle', box: around(0.5, 0.5) },
	{ label: '0.8 x 0.8 view in the middle', box: around(0.8, 0.8) },
	{ label: '0.9 x 0.9 view in the middle', box: around(0.9, 0.9) },
	{ label: '1.2 x 1.2 view in the middle', box: around(1.2, 1.2) },
	{ label: '3 x 0.2 view strip in the middle', box: around(3, 0.2) },
	{ label: '2 x 0.5 view in the middle', box: around(2, 0.5) },
	{ label: '0.2 x 3 view strip in the middle', box: around(0.2, 3) },
	{
		label: 'small, 1 % of the width inside the left edge',
		box: (view) => small(view, view.x + 0.01 * view.width, view.y + 0.3 * view.height)
	},
	{
		label: 'small, straddling the left edge',
		box: (view) => small(view, view.x - 0.02 * view.width, view.y + 0.3 * view.height)
	},
	{
		label: 'small, straddling the right edge',
		box: (view) => small(view, view.x + 0.98 * view.width, view.y + 0.3 * view.height)
	},
	{
		label: 'small, straddling the top edge',
		box: (view) => small(view, view.x + 0.3 * view.width, view.y - 0.02 * view.height)
	},
	{
		label: 'small, straddling the bottom edge',
		box: (view) => small(view, view.x + 0.3 * view.width, view.y + 0.98 * view.height)
	},
	{
		label: 'wide, hanging 10 % of the width out of the right edge',
		box: (view) => ({
			x: view.x + 0.7 * view.width,
			y: view.y + 0.3 * view.height,
			width: 0.4 * view.width,
			height: 0.05 * view.height
		})
	}
];

async function pasteCase(lab: Lab, zoom: number, entry: ViewCase): Promise<void> {
	const size = await viewSizeAt(lab, zoom);
	const centre = { x: 5000, y: 5000 };
	const view: Box = {
		x: centre.x - size.width / 2,
		y: centre.y - size.height / 2,
		width: size.width,
		height: size.height
	};
	const box = entry.box(view);
	await lab.resetToScene([node('rectangle', 'R', box.x, box.y, box.width, box.height)]);
	await lab.select(['R']);
	await lab.copy();
	await lab.tap('Escape');
	await showView(lab, zoom, centre);
	const observation = await observe(lab, () => lab.paste());
	lab.result(`zoom ${zoom}, ${entry.label}`, describeView(observation));
}

export const pasteView: Experiment = {
	name: 'paste-view',
	question:
		'After Ctrl+V of content that stays in place (original visible, nothing selected): when does the view pan, by how much, and when does it zoom to the content (larger than the safe area, covering it, strips)? (paste.md experiment 18, function 7674)',
	async run(lab) {
		for (const entry of CASES) await pasteCase(lab, 1, entry);
		await pasteCase(lab, 0.25, CASES[0]);
		await pasteCase(lab, 0.25, CASES[8]);
		await pasteCase(lab, 4, CASES[8]);
	}
};
