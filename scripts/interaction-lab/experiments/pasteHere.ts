import type { Experiment } from '../lab';
import {
	describeSelection,
	describeView,
	node,
	observe,
	showView,
	viewSizeAt
} from './pasteHelpers';

const FAR = { x: 20000, y: 20000 };

export const pasteHere: Experiment = {
	name: 'paste-here',
	question:
		'Context menu "Paste here": is the top-left corner of the content put on the cursor, also near the view edge, and when does the view zoom (content larger than the safe area) or pan? (paste.md experiment 16)',
	async run(lab) {
		const size = await viewSizeAt(lab, 1);
		const spots = [
			{ label: 'centre', x: 0.5, y: 0.5 },
			{ label: 'near the right edge', x: 0.97, y: 0.5 },
			{ label: 'near the top left corner', x: 0.03, y: 0.05 },
			{ label: 'near the bottom edge', x: 0.5, y: 0.85 }
		];
		const contents = [
			{ label: '100x80', width: 100, height: 80 },
			{ label: '0.5 view', width: 0.5 * size.width, height: 0.5 * size.height },
			{ label: '0.9 view wide', width: 0.9 * size.width, height: 0.3 * size.height },
			{ label: '0.9 view tall', width: 0.3 * size.width, height: 0.9 * size.height },
			{ label: '2 views', width: 2 * size.width, height: 2 * size.height }
		];
		for (const content of contents) {
			for (const spot of spots) {
				if (
					content.label !== '100x80' &&
					spot.label !== 'centre' &&
					spot.label !== 'near the right edge'
				)
					continue;
				await lab.resetToScene([
					node(
						'rectangle',
						'R',
						FAR.x,
						FAR.y,
						Math.round(content.width),
						Math.round(content.height)
					),
					node('rectangle', 'Other', FAR.x + 5000, FAR.y, 10, 10)
				]);
				await lab.select(['R']);
				await lab.copy();
				await lab.tap('Escape');
				const view = await showView(lab, 1, { x: 500, y: 500 });
				const target = await lab.canvasPoint(
					Math.round(view.x + spot.x * view.width),
					Math.round(view.y + spot.y * view.height)
				);
				// Mouse events land on whole client pixels; the cursor is what that pixel maps to.
				const point = { x: Math.round(target.x), y: Math.round(target.y) };
				const cursor = await lab.toCanvas(point);
				const label = `${content.label} content, cursor ${spot.label}`;
				const observation = await observe(lab, () => lab.contextMenuPick(point, 'Paste here'));
				lab.result(`${label}: selection`, describeSelection(observation));
				lab.result(`${label}: view`, describeView(observation));
				const [pasted] = observation.created;
				if (!pasted) continue;
				lab.result(
					`${label}: top-left minus cursor`,
					`${Math.round(pasted.x - cursor.x)},${Math.round(pasted.y - cursor.y)}`
				);
			}
		}
	}
};
