import type { Experiment } from '../lab';
import { frame, node, observe, record, showView } from './pasteHelpers';

const SOURCE = [
	node('rectangle', 'R', 500, 500, 100, 80),
	frame('S', 0, 0, 200, 150),
	frame('T', 300, 200, 200, 150)
];

export const pasteOtherPage: Experiment = {
	name: 'paste-other-page',
	question:
		'Ctrl+V on another page of the same file: where does the content land (original coordinates, centre of the view, page origin) for an empty and a non-empty page, a rectangle and a frame, and does a frame get pushed? (paste.md experiment 17, same file)',
	async run(lab) {
		for (const name of ['R', 'S', 'T']) {
			for (const target of ['empty', 'busy']) {
				await lab.resetToScene(SOURCE);
				await lab.select([name]);
				await lab.copy();
				const busyScene = [node('rectangle', 'X', 3000, 3000, 50, 50)];
				try {
					await lab.openScratchPage(target === 'busy' ? busyScene : undefined);
					await showView(lab, 1, { x: 1200, y: 900 });
					record(lab, `${name} on an ${target} second page`, await observe(lab, () => lab.paste()));
				} finally {
					await lab.closeScratchPage();
				}
			}
		}
		try {
			await lab.resetToScene(SOURCE);
			await lab.select(['S']);
			await lab.copy();
			await lab.openScratchPage([frame('S2', 0, 0, 200, 150)]);
			await showView(lab, 1, { x: 100, y: 75 });
			await lab.select(['S2']);
			record(
				lab,
				'S on a page with S2 at the same place, S2 selected',
				await observe(lab, () => lab.paste())
			);
		} finally {
			await lab.closeScratchPage();
		}
	}
};
