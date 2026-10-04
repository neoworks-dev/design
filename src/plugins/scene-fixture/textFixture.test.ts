import { beforeAll, describe, expect, it } from 'vitest';
import { createTextTestKit, type TextTestKit } from '../../lib/text/testing';
import { buildFixtureDocument } from './fixture';
import { TEXT_FRAME_ID } from './textFixture';

let kit: TextTestKit;

beforeAll(async () => {
	kit = await createTextTestKit();
});

describe('text fixture', () => {
	it('stores the size its text lays out to, for every auto-sized text node', () => {
		const document = buildFixtureDocument();
		const textNodes = Object.values(document.nodes).filter(
			(node) => node.type === 'TEXT' && node.parentId === TEXT_FRAME_ID
		);
		expect(textNodes.length).toBeGreaterThan(10);
		const wrong: string[] = [];
		for (const node of textNodes) {
			if (node.type !== 'TEXT' || node.textAutoResize === 'NONE') continue;
			const measure = kit.engine.measure(node);
			const width = node.textAutoResize === 'WIDTH_AND_HEIGHT' ? measure.width : node.width;
			const same =
				Math.round(node.height) === Math.round(measure.height) &&
				Math.round(node.width) === Math.round(width);
			if (!same) {
				wrong.push(`${node.id}: width ${Math.round(width)} height ${Math.round(measure.height)}`);
			}
		}
		expect(wrong).toEqual([]);
	});
});
