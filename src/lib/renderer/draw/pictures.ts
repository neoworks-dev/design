// Picture caching for the scene drawer (#45): a page-level container with enough descendants is
// recorded once, with every descendant (culling is off while recording, or the picture would miss
// what is off screen now), and replayed afterwards. See lib/renderer/pictureCache.ts.

import type { NodeId } from '../../document/types';
import { MIN_NODES_TO_RECORD } from '../pictureCache';
import type { DrawContext } from './context';

/** True when the node was drawn from a picture (recorded just now or earlier). */
export function drawFromPicture(
	context: DrawContext,
	id: NodeId,
	drawDirect: (context: DrawContext, id: NodeId) => void
): boolean {
	const cache = context.pictures;
	if (cache === null || !isPageLevelContainer(context, id)) return false;
	const entry = cache.lookup(id);
	if (entry && entry.kind === 'small') return false;
	if (!entry && !worthRecording(context, id)) {
		cache.markSmall(id);
		return false;
	}
	let picture;
	if (entry) {
		picture = entry.picture;
	} else {
		picture = cache.record(id, (recordingCanvas) => {
			const recordingContext: DrawContext = {
				...context,
				canvas: recordingCanvas,
				needed: null,
				pictures: null
			};
			drawDirect(recordingContext, id);
		});
		context.counters.picturesRecorded += 1;
	}
	context.counters.picturesReplayed += 1;
	context.canvas.drawPicture(picture);
	return true;
}

function isPageLevelContainer(context: DrawContext, id: NodeId): boolean {
	const node = context.source.getNode(id);
	if (!node || node.type === 'PAGE' || node.parentId === null) return false;
	const parent = context.source.getNode(node.parentId);
	if (!parent || parent.type !== 'PAGE') return false;
	return context.source.children(id).length > 0;
}

function worthRecording(context: DrawContext, id: NodeId): boolean {
	let count = 0;
	const pending: NodeId[] = [id];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		count += 1;
		if (count >= MIN_NODES_TO_RECORD) return true;
		for (const child of context.source.children(current)) pending.push(child);
	}
	return false;
}
