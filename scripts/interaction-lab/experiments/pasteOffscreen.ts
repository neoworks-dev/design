import type { Experiment, Lab } from '../lab';
import { classify, frame, observe, showView, viewSizeAt, type Box } from './pasteHelpers';

const ORIGINAL: Box = { x: 0, y: 0, width: 400, height: 300 };
const GAPS = [-0.05, -0.01, 0.01, 0.05, 0.1, 0.4, 1.6];

async function prepareCopy(
	lab: Lab,
	zoom: number,
	centre: { x: number; y: number },
	selected: boolean
): Promise<Box> {
	await lab.resetToScene([frame('A', 0, 0, 400, 300)]);
	await lab.select(['A']);
	await lab.copy();
	const view = await showView(lab, zoom, centre);
	if (selected) await lab.select(['A']);
	else await lab.tap('Escape');
	return view;
}

async function pasteAt(
	lab: Lab,
	label: string,
	zoom: number,
	centre: { x: number; y: number },
	selected: boolean
): Promise<void> {
	const view = await prepareCopy(lab, zoom, centre, selected);
	const observation = await observe(lab, () => lab.paste());
	const [copy] = observation.created;
	if (!copy) return lab.result(`${label}: placement`, 'nothing created');
	lab.result(`${label}: placement`, classify(copy, ORIGINAL, view));
}

export const pasteOffscreen: Experiment = {
	name: 'paste-offscreen',
	question:
		'Ctrl+V of a frame whose original is panned out of view (to the right of it by 5 % to 160 % of the view width, and above it), with the original selected or not, at zoom 1 and 0.25: when does the copy stay, get pushed or get centred in the view? Also a push that ends beyond the view, at zoom 4. (paste.md experiments 4, 5)',
	async run(lab) {
		for (const zoom of [1, 0.25]) {
			const size = await viewSizeAt(lab, zoom);
			for (const selected of [false, true]) {
				for (const gap of GAPS) {
					const centre = { x: 400 + gap * size.width + size.width / 2, y: 150 };
					const label = `zoom ${zoom}, ${selected ? 'A selected' : 'nothing selected'}, view starts ${gap} view widths right of A`;
					await pasteAt(lab, label, zoom, centre, selected);
				}
				for (const gap of [0.1, 1]) {
					const centre = { x: 200, y: 300 + gap * size.height + size.height / 2 };
					const label = `zoom ${zoom}, ${selected ? 'A selected' : 'nothing selected'}, view starts ${gap} view heights below A`;
					await pasteAt(lab, label, zoom, centre, selected);
				}
				const above = { x: 200, y: -0.1 * size.height - size.height / 2 };
				const aboveLabel = `zoom ${zoom}, ${selected ? 'A selected' : 'nothing selected'}, view ends 0.1 view heights above A`;
				await pasteAt(lab, aboveLabel, zoom, above, selected);
			}
		}

		// The push ends beyond the view: a 200 wide frame near the right edge, copy 240 further right.
		const small = { x: 0, y: 0, width: 200, height: 30 };
		for (const zoom of [4, 8]) {
			const size = await viewSizeAt(lab, zoom);
			for (const excess of [0.3, 0.45, 0.55, 0.8]) {
				const viewRight = small.x + 240 - excess * size.width;
				const centre = { x: viewRight - size.width / 2, y: 15 };
				await lab.resetToScene([frame('A', 0, 0, 200, 30)]);
				await lab.select(['A']);
				await lab.copy();
				const view = await showView(lab, zoom, centre);
				const observation = await observe(lab, () => lab.paste());
				const [copy] = observation.created;
				const label = `zoom ${zoom}, A selected, push ends ${excess} view widths beyond the right edge`;
				if (copy) lab.result(`${label}: placement`, classify(copy, small, view));
			}
		}
	}
};
