import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../document';
import { buildDocument, frame, group, page, rectangle, text } from '../document/fixtures';
import { resizeBox, ResizeSession, type HandleId, type ResizeModifiers } from './resize';

const NONE: ResizeModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const SIZE = { width: 100, height: 50 };

function modifiers(overrides: Partial<ResizeModifiers>): ResizeModifiers {
	return { ...NONE, ...overrides };
}

describe('resizeBox', () => {
	it.each<[string, HandleId, [number, number], Partial<ResizeModifiers>, number[]]>([
		// [name, handle, delta, modifiers, [width, height, originX, originY]]
		['corner pulls the opposite corner still', 'se', [20, 10], {}, [120, 60, 0, 0]],
		['top left keeps the bottom right still', 'nw', [-20, -10], {}, [120, 60, -20, -10]],
		['edge changes one axis only', 'e', [30, 99], {}, [130, 50, 0, 0]],
		[
			'Shift on a corner keeps the ratio (larger factor wins)',
			'se',
			[50, 0],
			{ shiftKey: true },
			[150, 75, 0, 0]
		],
		[
			'Shift on an edge scales the other axis about the centre',
			'e',
			[50, 0],
			{ shiftKey: true },
			[150, 75, 0, -12.5]
		],
		['Alt scales about the centre', 'e', [20, 0], { altKey: true }, [140, 50, -20, 0]],
		[
			'Alt and Shift together',
			'se',
			[20, 10],
			{ altKey: true, shiftKey: true },
			[140, 70, -20, -10]
		]
	])('%s', (_name, handle, delta, overrides, expected) => {
		const box = resizeBox(SIZE, handle, { x: delta[0], y: delta[1] }, modifiers(overrides));
		expect([box.width, box.height, box.originX, box.originY].map((value) => value + 0)).toEqual(
			expected
		);
		expect(box.flipX || box.flipY).toBe(false);
	});

	it('a locked proportion behaves like Shift', () => {
		const locked = resizeBox(SIZE, 'se', { x: 50, y: 0 }, NONE, true);
		expect([locked.width, locked.height]).toEqual([150, 75]);
	});

	it('flips when the handle crosses the opposite edge', () => {
		const box = resizeBox(SIZE, 'e', { x: -150, y: 0 }, NONE);
		expect(box).toMatchObject({ width: 50, height: 50, flipX: true, flipY: false });
		const both = resizeBox(SIZE, 'se', { x: -150, y: -80 }, NONE);
		expect(both).toMatchObject({ width: 50, height: 30, flipX: true, flipY: true });
	});

	it('never goes below the minimum size', () => {
		const box = resizeBox(SIZE, 'e', { x: -100, y: 0 }, NONE);
		expect(box.width).toBe(0.01);
	});
});

function storeOf(...pages: Parameters<typeof page>[1][]): DocumentStore {
	return new DocumentStore(buildDocument([page('P', pages[0], { id: 'p' })]));
}

function run(
	store: DocumentStore,
	ids: string[],
	handle: HandleId,
	delta: [number, number],
	overrides: Partial<ResizeModifiers> = {}
): void {
	const session = new ResizeSession(store, ids);
	const plan = session.plan({
		handle,
		delta: { x: delta[0], y: delta[1] },
		modifiers: modifiers(overrides)
	});
	store.applyAll(plan.changes);
}

function bounds(store: DocumentStore, id: string): number[] {
	const { x, y, width, height } = store.cache.absoluteBounds(id);
	return [x, y, width, height].map((value) => Math.round(value * 1000) / 1000);
}

describe('ResizeSession', () => {
	it('resizes one node by its handle', () => {
		const store = storeOf([
			rectangle({
				id: 'r',
				transform: [
					[1, 0, 10],
					[0, 1, 10]
				],
				width: 100,
				height: 50
			})
		]);
		run(store, ['r'], 'se', [20, 10]);
		expect(bounds(store, 'r')).toEqual([10, 10, 120, 60]);
	});

	it('resizes a rotated node along its own axes', () => {
		// Rotated a quarter turn: the local x axis points down the page.
		const store = storeOf([
			rectangle({
				id: 'r',
				transform: [
					[0, -1, 200],
					[1, 0, 0]
				],
				width: 100,
				height: 50
			})
		]);
		expect(bounds(store, 'r')).toEqual([150, 0, 50, 100]);
		run(store, ['r'], 'e', [0, 20]);
		expect(bounds(store, 'r')).toEqual([150, 0, 50, 120]);
		const node = store.requireNode('r');
		expect(node.type === 'RECTANGLE' && node.width).toBe(120);
	});

	it('Shift on a rotated node keeps its proportion', () => {
		const store = storeOf([
			rectangle({
				id: 'r',
				transform: [
					[0, -1, 200],
					[1, 0, 0]
				],
				width: 100,
				height: 50
			})
		]);
		run(store, ['r'], 'e', [0, 50], { shiftKey: true });
		expect(bounds(store, 'r')).toEqual([137.5, 0, 75, 150]);
	});

	it('flips through the opposite edge', () => {
		const store = storeOf([
			rectangle({
				id: 'r',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 100,
				height: 50
			})
		]);
		run(store, ['r'], 'e', [-200, 0]);
		expect(bounds(store, 'r')).toEqual([-100, 0, 100, 50]);
	});

	it('scales a multi selection about its combined bounds', () => {
		const store = storeOf([
			rectangle({
				id: 'a',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 50,
				height: 50
			}),
			rectangle({
				id: 'b',
				transform: [
					[1, 0, 100],
					[0, 1, 0]
				],
				width: 50,
				height: 50
			})
		]);
		run(store, ['a', 'b'], 'e', [150, 0]);
		expect(bounds(store, 'a')).toEqual([0, 0, 100, 50]);
		expect(bounds(store, 'b')).toEqual([200, 0, 100, 50]);
	});

	it('Alt scales a multi selection about the centre', () => {
		const store = storeOf([
			rectangle({
				id: 'a',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 50,
				height: 50
			}),
			rectangle({
				id: 'b',
				transform: [
					[1, 0, 100],
					[0, 1, 0]
				],
				width: 50,
				height: 50
			})
		]);
		run(store, ['a', 'b'], 'e', [50, 0], { altKey: true });
		expect(bounds(store, 'a')).toEqual([-50, 0, 83.333, 50]);
		expect(bounds(store, 'b')).toEqual([116.667, 0, 83.333, 50]);
	});

	it('a group scales its children', () => {
		const store = storeOf([
			group(
				{
					id: 'g',
					transform: [
						[1, 0, 0],
						[0, 1, 0]
					],
					width: 100,
					height: 100
				},
				[
					rectangle({
						id: 'k',
						transform: [
							[1, 0, 50],
							[0, 1, 50]
						],
						width: 50,
						height: 50
					})
				]
			)
		]);
		run(store, ['g'], 'se', [100, 100]);
		expect(bounds(store, 'g')).toEqual([0, 0, 200, 200]);
		expect(bounds(store, 'k')).toEqual([100, 100, 100, 100]);
	});

	it('a frame applies its children constraints, Ctrl ignores them', () => {
		const make = (): DocumentStore =>
			storeOf([
				frame(
					{
						id: 'f',
						transform: [
							[1, 0, 0],
							[0, 1, 0]
						],
						width: 100,
						height: 100
					},
					[
						rectangle({
							id: 'right',
							transform: [
								[1, 0, 80],
								[0, 1, 0]
							],
							width: 20,
							height: 20,
							constraints: { horizontal: 'MAX', vertical: 'MIN' }
						}),
						rectangle({
							id: 'stretch',
							transform: [
								[1, 0, 10],
								[0, 1, 50]
							],
							width: 80,
							height: 20,
							constraints: { horizontal: 'STRETCH', vertical: 'MIN' }
						})
					]
				)
			]);
		const constrained = make();
		run(constrained, ['f'], 'e', [50, 0]);
		expect(bounds(constrained, 'right')).toEqual([130, 0, 20, 20]);
		expect(bounds(constrained, 'stretch')).toEqual([10, 50, 130, 20]);
		const ignored = make();
		run(ignored, ['f'], 'e', [50, 0], { ctrlKey: true });
		expect(bounds(ignored, 'right')).toEqual([80, 0, 20, 20]);
		expect(bounds(ignored, 'stretch')).toEqual([10, 50, 80, 20]);
	});

	it('text: side handles make the height automatic, corners fix the size', () => {
		const store = storeOf([
			text({
				id: 't',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 100,
				height: 20
			})
		]);
		run(store, ['t'], 'e', [20, 0]);
		expect(store.requireNode('t')).toMatchObject({ textAutoResize: 'HEIGHT', width: 120 });
		run(store, ['t'], 'se', [10, 10]);
		expect(store.requireNode('t')).toMatchObject({ textAutoResize: 'NONE', width: 130 });
	});

	it('hug sizing becomes fixed on the axis that was resized', () => {
		const store = storeOf([
			frame({
				id: 'f',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 100,
				height: 100,
				layoutSizingHorizontal: 'HUG',
				layoutSizingVertical: 'HUG'
			})
		]);
		run(store, ['f'], 'e', [10, 0]);
		expect(store.requireNode('f')).toMatchObject({
			layoutSizingHorizontal: 'FIXED',
			layoutSizingVertical: 'HUG'
		});
	});

	it('ignores locked nodes and reports the resulting size', () => {
		const store = storeOf([
			rectangle({
				id: 'l',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 10,
				height: 10,
				locked: true
			})
		]);
		const session = new ResizeSession(store, ['l']);
		expect(session.isEmpty).toBe(true);
	});

	it('plans from the start state: replanning never accumulates', () => {
		const store = storeOf([
			rectangle({
				id: 'r',
				transform: [
					[1, 0, 0],
					[0, 1, 0]
				],
				width: 100,
				height: 50
			})
		]);
		const session = new ResizeSession(store, ['r']);
		for (const dx of [10, 30, 20]) {
			const plan = session.plan({ handle: 'e', delta: { x: dx, y: 0 }, modifiers: NONE });
			store.applyAll(plan.changes);
		}
		expect(bounds(store, 'r')).toEqual([0, 0, 120, 50]);
	});
});
