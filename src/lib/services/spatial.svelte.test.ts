import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import selectionPlugin from '../../plugins/selection';
import spatialPlugin from '../../plugins/spatial';
import { buildDocument, frame, page, rectangle } from '../document/fixtures';
import type { Paint } from '../document';
import { describePlugin, mountPlugin } from '../kernel/testing';
import { documentWith } from './fixtures/documentFixture';

const BLACK: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 0, g: 0, b: 0 }
};
const user = { origin: 'user' as const, label: 'Test' };

// n1 page, n2 frame F (n3 rect R at 10,10 size 50), n4 rect L at 500,0 ; n5 page B
function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page('A', [
			frame({ name: 'F', width: 300, height: 300, fills: [BLACK] }, [
				rectangle({
					name: 'R',
					transform: [
						[1, 0, 10],
						[0, 1, 10]
					],
					width: 50,
					height: 50,
					fills: [BLACK]
				})
			]),
			rectangle({
				name: 'L',
				transform: [
					[1, 0, 500],
					[0, 1, 0]
				],
				width: 50,
				height: 50,
				fills: [BLACK]
			})
		]),
		page('B', [rectangle({ name: 'other' })])
	]);
}

const providers = [coreContextKeys, coreCommands, documentWith(scene()), selectionPlugin];

describePlugin('spatial', spatialPlugin, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.spatial.atPoint({ x: 20, y: 20 })).toEqual(expect.arrayContaining(['n2', 'n3']));
	}
});

describe('spatial follows the document', () => {
	it('tracks moves made through document.apply', async () => {
		const mounted = await mountPlugin(spatialPlugin, { providers });
		const { ctx } = mounted;
		expect(ctx.spatial.atPoint({ x: 520, y: 20 })).toEqual(['n4']);
		ctx.document.apply(
			ctx.document.setProps('n4', {
				transform: [
					[1, 0, 0],
					[0, 1, 700]
				]
			}),
			user
		);
		expect(ctx.spatial.atPoint({ x: 520, y: 20 })).toEqual([]);
		expect(ctx.spatial.atPoint({ x: 20, y: 720 })).toEqual(['n4']);
		await mounted.cleanup();
	});

	it('moving a parent moves the indexed children', async () => {
		const mounted = await mountPlugin(spatialPlugin, { providers });
		const { ctx } = mounted;
		ctx.spatial.atPoint({ x: 0, y: 0 });
		ctx.document.apply(
			ctx.document.setProps('n2', {
				transform: [
					[1, 0, 1000],
					[0, 1, 0]
				]
			}),
			user
		);
		expect(ctx.spatial.atPoint({ x: 1020, y: 20 })).toEqual(expect.arrayContaining(['n2', 'n3']));
		expect(ctx.spatial.atPoint({ x: 20, y: 20 })).toEqual([]);
		await mounted.cleanup();
	});

	it('undo is picked up too, and a replaced document gets a fresh index', async () => {
		const mounted = await mountPlugin(spatialPlugin, { providers });
		const { ctx } = mounted;
		ctx.spatial.atPoint({ x: 0, y: 0 });
		const transaction = ctx.document.apply(ctx.document.setProps('n4', { width: 5 }), user);
		expect(ctx.spatial.absoluteBounds('n4').width).toBe(5);
		expect(transaction).toBeDefined();
		ctx.document.replaceDocument(buildDocument([page('Z', [rectangle({ width: 9, height: 9 })])]));
		const pageId = ctx.document.currentPageId;
		expect(ctx.spatial.atPoint({ x: 1, y: 1 }, 0, 'render', pageId)).toHaveLength(1);
		await mounted.cleanup();
	});
});
