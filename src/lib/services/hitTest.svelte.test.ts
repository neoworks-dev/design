import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import hitTestPlugin from '../../plugins/hit-test';
import selectionPlugin from '../../plugins/selection';
import spatialPlugin from '../../plugins/spatial';
import type { Paint } from '../document';
import { buildDocument, frame, group, page, rectangle } from '../document/fixtures';
import { describePlugin, mountPlugin } from '../kernel/testing';
import { documentWith } from './fixtures/documentFixture';

const BLACK: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 0, g: 0, b: 0 }
};

// n1 page A: n2 frame F (n3 group G (n4 R1 0,0 100 ; n5 R2 50,50 100)) ; n6 page B: n7 rect
function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page('A', [
			frame({ name: 'F', width: 400, height: 400, fills: [BLACK] }, [
				group({ name: 'G', width: 150, height: 150 }, [
					rectangle({ name: 'R1', width: 100, height: 100, fills: [BLACK] }),
					rectangle({
						name: 'R2',
						transform: [
							[1, 0, 50],
							[0, 1, 50]
						],
						width: 100,
						height: 100,
						fills: [BLACK]
					})
				])
			])
		]),
		page('B', [rectangle({ name: 'other', width: 100, height: 100, fills: [BLACK] })])
	]);
}

const providers = [
	coreContextKeys,
	coreCommands,
	documentWith(scene()),
	selectionPlugin,
	spatialPlugin
];

describePlugin('hit-test', hitTestPlugin, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.hitTest.topAtScope({ point: { x: 20, y: 20 } })).toBe('n3');
		expect(ctx.hitTest.topAtScope({ point: { x: 300, y: 300 } })).toBeUndefined();
	}
});

describe('hitTest service', () => {
	it('uses the selection scope and the current page', async () => {
		const mounted = await mountPlugin(hitTestPlugin, { providers });
		const { ctx } = mounted;
		const point = { x: 75, y: 75 };
		expect(ctx.hitTest.topAtScope({ point })).toBe('n3');
		expect(ctx.hitTest.deepest({ point })).toBe('n5');
		expect(ctx.hitTest.all({ point })).toEqual(['n5', 'n4', 'n2']);
		ctx.selection.setScope('n3');
		expect(ctx.hitTest.topAtScope({ point })).toBe('n5');
		expect(ctx.hitTest.topAtScope({ point: { x: 10, y: 10 } })).toBe('n4');
		expect(ctx.hitTest.hits({ point })[0]).toEqual({ id: 'n5', kind: 'fill' });
		await mounted.cleanup();
	});

	it('sees edits made through document.apply', async () => {
		const mounted = await mountPlugin(hitTestPlugin, { providers });
		const { ctx } = mounted;
		expect(ctx.hitTest.deepest({ point: { x: 140, y: 140 } })).toBe('n5');
		ctx.document.apply(ctx.document.setProps('n5', { locked: true }), {
			origin: 'user',
			label: 'Lock'
		});
		expect(ctx.hitTest.deepest({ point: { x: 140, y: 140 } })).toBe('n2');
		await mounted.cleanup();
	});
});
