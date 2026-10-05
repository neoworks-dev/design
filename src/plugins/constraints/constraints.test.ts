import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { NodeId } from '../../lib/document';
import { buildDocument, frame, page, rectangle } from '../../lib/document/fixtures';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { at, editingProviders } from '../../lib/editing/fixtures/editingFixture';
import constraints from './index';

type Axis = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
const AXES: Axis[] = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'];

// Frame 100x100 grows to 200x160; the child spans 10..30 on both axes.
const GROWTH = { horizontal: 100, vertical: 60 };
const OLD = { horizontal: 100, vertical: 100 };

function expectedSpan(axis: Axis, growth: number, oldSize: number): [number, number] {
	if (axis === 'MIN') return [10, 20];
	if (axis === 'MAX') return [10 + growth, 20];
	if (axis === 'CENTER') return [10 + growth / 2, 20];
	if (axis === 'STRETCH') return [10, 20 + growth];
	const ratio = (oldSize + growth) / oldSize;
	return [10 * ratio, 20 * ratio];
}

function sample(): ReturnType<typeof buildDocument> {
	const children = [];
	for (const horizontal of AXES) {
		for (const vertical of AXES) {
			children.push(
				rectangle({
					id: `${horizontal}-${vertical}`,
					transform: at(10, 10),
					width: 20,
					height: 20,
					constraints: { horizontal, vertical }
				})
			);
		}
	}
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'f', transform: at(0, 0), width: 100, height: 100 }, children),
				frame(
					{ id: 'auto', transform: at(300, 0), width: 100, height: 100, layoutMode: 'HORIZONTAL' },
					[rectangle({ id: 'inAuto', transform: at(0, 0), width: 20, height: 20 })]
				),
				frame({ id: 'outer', transform: at(500, 0), width: 100, height: 100 }, [
					frame(
						{
							id: 'inner',
							transform: at(0, 0),
							width: 100,
							height: 100,
							constraints: { horizontal: 'STRETCH', vertical: 'STRETCH' }
						},
						[
							rectangle({
								id: 'deep',
								transform: at(0, 0),
								width: 100,
								height: 20,
								constraints: { horizontal: 'STRETCH', vertical: 'MIN' }
							})
						]
					)
				])
			],
			{ id: 'p0' }
		)
	]);
}

describePlugin('constraints', constraints, {
	providers: editingProviders(sample()),
	contributes: ({ ctx }) => {
		expect(ctx.document).toBeDefined();
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(constraints, { providers: editingProviders(sample()) });
	return mounted.ctx;
}

function box(ctx: Context, id: NodeId): number[] {
	const node = ctx.document.require(id);
	if (node.type === 'PAGE') throw new Error('page');
	return [node.transform[0][2], node.transform[1][2], node.width, node.height];
}

function resize(
	ctx: Context,
	id: NodeId,
	size: { width: number; height: number },
	meta: { ignoreConstraints?: boolean } = {}
): void {
	ctx.document.apply(ctx.document.setProps(id, size), { origin: 'user', label: 'Resize', ...meta });
}

describe('resizing a frame applies the constraints of its children', () => {
	for (const horizontal of AXES) {
		for (const vertical of AXES) {
			it(`${horizontal} / ${vertical}`, async () => {
				const ctx = await open();
				resize(ctx, 'f', { width: 200, height: 160 });
				const [x, width] = expectedSpan(horizontal, GROWTH.horizontal, OLD.horizontal);
				const [y, height] = expectedSpan(vertical, GROWTH.vertical, OLD.vertical);
				expect(box(ctx, `${horizontal}-${vertical}`)).toEqual([x, y, width, height]);
			});
		}
	}

	it('is one undo step that restores every child', async () => {
		const ctx = await open();
		const before = box(ctx, 'STRETCH-MAX');
		resize(ctx, 'f', { width: 200, height: 160 });
		expect(ctx.history.entries).toHaveLength(1);
		ctx.history.undo();
		expect(box(ctx, 'STRETCH-MAX')).toEqual(before);
		expect(box(ctx, 'f')).toEqual([0, 0, 100, 100]);
	});

	it('Ctrl (ignoreConstraints) leaves the children alone', async () => {
		const ctx = await open();
		resize(ctx, 'f', { width: 200, height: 160 }, { ignoreConstraints: true });
		expect(box(ctx, 'MAX-MAX')).toEqual([10, 10, 20, 20]);
	});

	it('does not touch children of an auto layout frame', async () => {
		const ctx = await open();
		resize(ctx, 'auto', { width: 300, height: 300 });
		expect(box(ctx, 'inAuto')).toEqual([0, 0, 20, 20]);
	});

	it('cascades into a resized child frame', async () => {
		const ctx = await open();
		resize(ctx, 'outer', { width: 200, height: 100 });
		expect(box(ctx, 'inner')).toEqual([0, 0, 200, 100]);
		expect(box(ctx, 'deep')).toEqual([0, 0, 200, 20]);
	});

	it('does nothing when the size did not change', async () => {
		const ctx = await open();
		const transaction = ctx.document.apply(ctx.document.setProps('f', { name: 'F' }), {
			origin: 'user',
			label: 'Rename'
		});
		expect(transaction.changes).toHaveLength(1);
	});
});
