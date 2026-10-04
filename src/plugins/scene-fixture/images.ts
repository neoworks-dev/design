import type { Context } from '@neoworks/extension-system';
import {
	FIXTURE_FILE_ID,
	FIXTURE_IMAGE_NODE_IDS,
	FIXTURE_PENDING_IMAGE,
	fixtureImageBytes
} from './fixture';

/**
 * Stores the fixture picture in the open file and points the fixture's image paints at it, in one
 * change set (the flow `blobs.put` documents: apply `changes` together with the paint).
 */
export async function attachFixtureImages(ctx: Context): Promise<void> {
	const stored = await ctx.blobs.put(fixtureImageBytes());
	const { document } = ctx;
	if (document.documentId !== FIXTURE_FILE_ID) return;
	const changes = [...stored.changes];
	for (const id of FIXTURE_IMAGE_NODE_IDS) {
		const node = document.get(id);
		if (!node || !('fills' in node)) continue;
		const fills = node.fills.map((paint) => {
			if (paint.type !== 'IMAGE' || paint.imageHash !== FIXTURE_PENDING_IMAGE) return paint;
			return { ...paint, imageHash: stored.hash };
		});
		changes.push(...document.setProps(id, { fills }));
	}
	if (changes.length === 0) return;
	document.apply(changes, { origin: 'plugin', label: 'Fixture images' });
}
