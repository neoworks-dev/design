import { describe, expect, it } from 'vitest';
import { boxes, fakeText, leaf, stack } from './testing';
import { breakLines, computeLayout, distribute } from './engine';
import type { LayoutContainer, LayoutItem } from './types';

const PADDING_10 = { top: 10, right: 10, bottom: 10, left: 10 };

function twoItems(): LayoutItem[] {
	return [leaf('a', 50, 20), leaf('b', 30, 40)];
}

describe('stack alignment', () => {
	const cases = [
		{
			name: 'horizontal, min / min',
			settings: {},
			a: { x: 10, y: 10 },
			b: { x: 65, y: 10 }
		},
		{
			name: 'horizontal, centered both ways',
			settings: { primaryAlign: 'CENTER', counterAlign: 'CENTER' },
			a: { x: 107.5, y: 40 },
			b: { x: 162.5, y: 30 }
		},
		{
			name: 'horizontal, max / max',
			settings: { primaryAlign: 'MAX', counterAlign: 'MAX' },
			a: { x: 205, y: 70 },
			b: { x: 260, y: 50 }
		},
		{
			name: 'horizontal, space between',
			settings: { primaryAlign: 'SPACE_BETWEEN' },
			a: { x: 10, y: 10 },
			b: { x: 260, y: 10 }
		},
		{
			name: 'vertical, min / min',
			settings: { mode: 'VERTICAL' },
			a: { x: 10, y: 10 },
			b: { x: 10, y: 35 }
		},
		{
			name: 'vertical, centered both ways',
			settings: { mode: 'VERTICAL', primaryAlign: 'CENTER', counterAlign: 'CENTER' },
			a: { x: 125, y: 10 + (80 - 65) / 2 },
			b: { x: 135, y: 10 + (80 - 65) / 2 + 25 }
		},
		{
			name: 'vertical, max / max',
			settings: { mode: 'VERTICAL', primaryAlign: 'MAX', counterAlign: 'MAX' },
			a: { x: 240, y: 10 + 15 },
			b: { x: 260, y: 10 + 15 + 25 }
		}
	] as const;

	for (const testCase of cases) {
		it(testCase.name, () => {
			const root = stack(
				'root',
				{ width: 300, height: 100 },
				{ padding: PADDING_10, itemSpacing: 5, ...testCase.settings },
				twoItems()
			);
			const result = boxes(root);
			expect(result.root).toMatchObject({ width: 300, height: 100 });
			expect(result.a).toMatchObject({ ...testCase.a, width: 50, height: 20 });
			expect(result.b).toMatchObject({ ...testCase.b, width: 30, height: 40 });
		});
	}
});

describe('hug', () => {
	it('sums the children, the gap and the padding on the primary axis', () => {
		const root = stack(
			'root',
			{ width: 1, height: 1 },
			{ padding: PADDING_10, itemSpacing: 5 },
			twoItems(),
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		expect(boxes(root).root).toMatchObject({ width: 105, height: 60 });
	});

	it('takes the tallest child on the counter axis', () => {
		const root = stack(
			'root',
			{ width: 1, height: 1 },
			{ mode: 'VERTICAL', itemSpacing: 5 },
			twoItems(),
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		expect(boxes(root).root).toMatchObject({ width: 50, height: 65 });
	});

	it('hugs one axis and keeps the other fixed', () => {
		const root = stack('root', { width: 400, height: 90 }, {}, twoItems(), {
			sizingHorizontal: 'HUG'
		});
		expect(boxes(root).root).toMatchObject({ width: 80, height: 90 });
	});

	it('is just the padding without children', () => {
		const root = stack('root', { width: 1, height: 1 }, { padding: PADDING_10 }, [], {
			sizingHorizontal: 'HUG',
			sizingVertical: 'HUG'
		});
		expect(boxes(root).root).toMatchObject({ width: 20, height: 20 });
	});

	it('nests: a hugging container inside a hugging container', () => {
		const inner = stack(
			'inner',
			{ width: 1, height: 1 },
			{ itemSpacing: 4, padding: { top: 2, right: 2, bottom: 2, left: 2 } },
			twoItems(),
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		const root = stack(
			'root',
			{ width: 1, height: 1 },
			{ mode: 'VERTICAL', itemSpacing: 10 },
			[inner, leaf('c', 20, 20)],
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		const result = boxes(root);
		expect(result.inner).toMatchObject({ x: 0, y: 0, width: 88, height: 44 });
		expect(result.a).toMatchObject({ x: 2, y: 2 });
		expect(result.b).toMatchObject({ x: 56, y: 2 });
		expect(result.c).toMatchObject({ x: 0, y: 54 });
		expect(result.root).toMatchObject({ width: 88, height: 74 });
	});

	it('measures a fill child like a hug child when the parent hugs', () => {
		const root = stack(
			'root',
			{ width: 1, height: 1 },
			{ itemSpacing: 10 },
			[leaf('a', 50, 20), leaf('b', 30, 20, { sizingHorizontal: 'FILL' })],
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		const result = boxes(root);
		expect(result.root.width).toBe(90);
		expect(result.b).toMatchObject({ x: 60, width: 30 });
	});
});

describe('fill', () => {
	it('splits the free space equally between fill children', () => {
		const root = stack('root', { width: 300, height: 100 }, { itemSpacing: 10 }, [
			leaf('a', 50, 20),
			leaf('b', 1, 20, { sizingHorizontal: 'FILL' }),
			leaf('c', 1, 20, { sizingHorizontal: 'FILL' })
		]);
		const result = boxes(root);
		expect(result.b).toMatchObject({ x: 60, width: 115 });
		expect(result.c).toMatchObject({ x: 185, width: 115 });
	});

	it('honours max and min while distributing', () => {
		const root = stack('root', { width: 300, height: 100 }, { itemSpacing: 10 }, [
			leaf('a', 50, 20),
			leaf('b', 1, 20, { sizingHorizontal: 'FILL' }),
			leaf('c', 1, 20, { sizingHorizontal: 'FILL', maxWidth: 100 })
		]);
		const result = boxes(root);
		expect(result.b.width).toBe(130);
		expect(result.c).toMatchObject({ x: 200, width: 100 });
		const minimum = stack('root', { width: 300, height: 100 }, { itemSpacing: 10 }, [
			leaf('a', 50, 20),
			leaf('b', 1, 20, { sizingHorizontal: 'FILL', minWidth: 200 }),
			leaf('c', 1, 20, { sizingHorizontal: 'FILL' })
		]);
		expect(boxes(minimum).b.width).toBe(200);
		expect(boxes(minimum).c.width).toBe(30);
	});

	it('stretches a counter-axis fill child across the container', () => {
		const root = stack('root', { width: 300, height: 100 }, { padding: PADDING_10 }, [
			leaf('a', 50, 20, { sizingVertical: 'FILL' })
		]);
		expect(boxes(root).a).toMatchObject({ y: 10, height: 80 });
	});

	it('stretches to the tallest sibling when the container hugs the counter axis', () => {
		const root = stack(
			'root',
			{ width: 300, height: 1 },
			{},
			[leaf('a', 50, 70), leaf('b', 50, 20, { sizingVertical: 'FILL' })],
			{ sizingVertical: 'HUG' }
		);
		expect(boxes(root).root.height).toBe(70);
		expect(boxes(root).b.height).toBe(70);
	});

	it('resolves nested fill: a filling container fills its own children', () => {
		const inner = stack(
			'inner',
			{ width: 1, height: 1 },
			{},
			[leaf('a', 50, 20), leaf('b', 1, 20, { sizingHorizontal: 'FILL' })],
			{ sizingHorizontal: 'FILL', sizingVertical: 'HUG' }
		);
		const root = stack('root', { width: 200, height: 100 }, { padding: PADDING_10 }, [inner]);
		const result = boxes(root);
		expect(result.inner).toMatchObject({ x: 10, y: 10, width: 180, height: 20 });
		expect(result.b).toMatchObject({ x: 50, width: 130 });
	});

	it('gives fill children nothing when the others already overflow', () => {
		const root = stack('root', { width: 100, height: 100 }, {}, [
			leaf('a', 150, 20),
			leaf('b', 1, 20, { sizingHorizontal: 'FILL' })
		]);
		expect(boxes(root).b).toMatchObject({ x: 150, width: 0 });
	});
});

describe('min and max', () => {
	it('clamps a hugging container', () => {
		const root = stack('root', { width: 1, height: 1 }, {}, twoItems(), {
			sizingHorizontal: 'HUG',
			sizingVertical: 'HUG',
			minWidth: 200,
			maxHeight: 30
		});
		expect(boxes(root).root).toMatchObject({ width: 200, height: 30 });
	});

	it('clamps a fixed container and a leaf', () => {
		const root = stack(
			'root',
			{ width: 500, height: 100 },
			{},
			[leaf('a', 80, 20, { maxWidth: 60 })],
			{
				maxWidth: 300
			}
		);
		const result = boxes(root);
		expect(result.root.width).toBe(300);
		expect(result.a.width).toBe(60);
	});
});

describe('absolute positioning', () => {
	it('leaves absolute children where they are and out of the flow', () => {
		const root = stack(
			'root',
			{ width: 1, height: 1 },
			{ itemSpacing: 10 },
			[
				leaf('a', 50, 20),
				leaf('floating', 400, 400, { positioning: 'ABSOLUTE', x: 7, y: 9 }),
				leaf('b', 30, 20)
			],
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		const result = boxes(root);
		expect(result.root).toMatchObject({ width: 90, height: 20 });
		expect(result.floating).toMatchObject({ x: 7, y: 9, width: 400, height: 400 });
		expect(result.b.x).toBe(60);
	});

	it('still lays out the children of an absolute auto layout frame', () => {
		const floating = stack('floating', { width: 1, height: 1 }, { itemSpacing: 2 }, twoItems(), {
			positioning: 'ABSOLUTE',
			x: 100,
			y: 100,
			sizingHorizontal: 'HUG',
			sizingVertical: 'HUG'
		});
		const root = stack('root', { width: 300, height: 300 }, {}, [floating]);
		const result = boxes(root);
		expect(result.floating).toMatchObject({ x: 100, y: 100, width: 82, height: 40 });
		expect(result.b).toMatchObject({ x: 52, y: 0 });
	});
});

describe('wrap', () => {
	function wrapped(settings = {}, size = { width: 100, height: 1 }): LayoutContainer {
		return stack(
			'root',
			size,
			{ wrap: true, itemSpacing: 10, ...settings },
			[leaf('a', 40, 20), leaf('b', 40, 20), leaf('c', 40, 20)],
			{ sizingVertical: size.height === 1 ? 'HUG' : 'FIXED' }
		);
	}

	it('breaks lines at the container width and uses the gap between lines', () => {
		const result = boxes(wrapped());
		expect(result.a).toMatchObject({ x: 0, y: 0 });
		expect(result.b).toMatchObject({ x: 50, y: 0 });
		expect(result.c).toMatchObject({ x: 0, y: 30 });
		expect(result.root.height).toBe(50);
	});

	it('uses the counter spacing between lines when it is set', () => {
		const result = boxes(wrapped({ counterSpacing: 4 }));
		expect(result.c.y).toBe(24);
		expect(result.root.height).toBe(44);
	});

	it('spaces lines out across a fixed height', () => {
		const result = boxes(
			wrapped({ itemSpacing: 0, counterContentAlign: 'SPACE_BETWEEN' }, { width: 50, height: 100 })
		);
		expect(result.a.y).toBe(0);
		expect(result.b.y).toBe(40);
		expect(result.c.y).toBe(80);
	});

	it('applies the primary alignment per line', () => {
		const result = boxes(wrapped({ primaryAlign: 'SPACE_BETWEEN', itemSpacing: 0 }));
		expect(result.a.x).toBe(0);
		expect(result.b.x).toBe(60);
		expect(result.c.x).toBe(0);
	});

	it('lets fill children grow to the end of their line', () => {
		const root = stack('root', { width: 100, height: 100 }, { wrap: true, itemSpacing: 10 }, [
			leaf('a', 40, 20),
			leaf('b', 40, 20, { sizingHorizontal: 'FILL' }),
			leaf('c', 40, 20)
		]);
		const result = boxes(root);
		expect(result.b).toMatchObject({ x: 50, width: 50 });
		expect(result.c).toMatchObject({ x: 0, y: 30 });
	});

	it('aligns items on the counter axis within their line', () => {
		const root = stack(
			'root',
			{ width: 100, height: 100 },
			{ wrap: true, counterAlign: 'CENTER' },
			[leaf('tall', 40, 40), leaf('short', 40, 20)]
		);
		const result = boxes(root);
		expect(result.short.y).toBe(10);
	});
});

describe('strokes included in layout', () => {
	const insets = { top: 2, right: 2, bottom: 2, left: 2 };

	it('counts the stroke space of children in hug and in positions', () => {
		const root = stack(
			'root',
			{ width: 1, height: 1 },
			{},
			[leaf('a', 50, 20, { strokeInsets: insets }), leaf('b', 30, 20, { strokeInsets: insets })],
			{ sizingHorizontal: 'HUG', sizingVertical: 'HUG' }
		);
		const result = boxes(root);
		expect(result.root).toMatchObject({ width: 88, height: 24 });
		expect(result.a).toMatchObject({ x: 2, y: 2 });
		expect(result.b).toMatchObject({ x: 56, y: 2 });
	});

	it('subtracts the stroke space from what a fill child receives', () => {
		const root = stack('root', { width: 100, height: 40 }, {}, [
			leaf('a', 1, 20, { sizingHorizontal: 'FILL', sizingVertical: 'FILL', strokeInsets: insets })
		]);
		expect(boxes(root).a).toMatchObject({ x: 2, y: 2, width: 96, height: 36 });
	});
});

describe('text', () => {
	it('hugs the natural text size', () => {
		const text = leaf('t', 1, 1, {
			sizingHorizontal: 'HUG',
			sizingVertical: 'HUG',
			measureText: fakeText('hello')
		});
		const root = stack('root', { width: 1, height: 1 }, { padding: PADDING_10 }, [text], {
			sizingHorizontal: 'HUG',
			sizingVertical: 'HUG'
		});
		const result = boxes(root);
		expect(result.t).toMatchObject({ width: 50, height: 20 });
		expect(result.root).toMatchObject({ width: 70, height: 40 });
	});

	it('wraps fill-width text and grows the hugging container with the lines', () => {
		const text = leaf('t', 1, 1, {
			sizingHorizontal: 'FILL',
			sizingVertical: 'HUG',
			measureText: fakeText('a'.repeat(20))
		});
		const root = stack('root', { width: 100, height: 1 }, { mode: 'VERTICAL' }, [text], {
			sizingVertical: 'HUG'
		});
		const result = boxes(root);
		expect(result.t).toMatchObject({ width: 100, height: 40 });
		expect(result.root.height).toBe(40);
	});

	it('keeps a fixed-width auto-height text at its width', () => {
		const text = leaf('t', 60, 1, {
			sizingVertical: 'HUG',
			measureText: fakeText('a'.repeat(20))
		});
		const root = stack('root', { width: 300, height: 100 }, {}, [text]);
		expect(boxes(root).t).toMatchObject({ width: 60, height: 80 });
	});
});

describe('properties of the algorithm', () => {
	function applyResults(root: LayoutContainer): LayoutContainer {
		const results = computeLayout(root);
		const update = <T extends LayoutItem>(item: T): T => {
			const result = results.get(item.id);
			if (result === undefined) return item;
			const next = { ...item, width: result.width, height: result.height };
			if (item.positioning !== 'ABSOLUTE') {
				next.x = result.x;
				next.y = result.y;
			}
			if (next.kind === 'container') next.children = next.children.map(update);
			return next;
		};
		return update(root);
	}

	it('is idempotent: laying out the result again changes nothing', () => {
		const inner = stack(
			'inner',
			{ width: 1, height: 1 },
			{ itemSpacing: 3, primaryAlign: 'SPACE_BETWEEN' },
			[leaf('a', 50, 20), leaf('b', 1, 30, { sizingHorizontal: 'FILL' })],
			{ sizingHorizontal: 'FILL', sizingVertical: 'HUG' }
		);
		const root = stack(
			'root',
			{ width: 333, height: 100 },
			{ mode: 'VERTICAL', padding: PADDING_10, itemSpacing: 7, counterAlign: 'CENTER' },
			[
				inner,
				leaf('t', 1, 1, {
					sizingHorizontal: 'FILL',
					sizingVertical: 'HUG',
					measureText: fakeText('a'.repeat(50))
				})
			],
			{ sizingVertical: 'HUG' }
		);
		const first = computeLayout(root);
		const again = computeLayout(applyResults(root));
		expect([...again.values()]).toEqual([...first.values()]);
	});

	it('lays out 2000 children quickly', () => {
		const children = Array.from({ length: 2000 }, (_, index) =>
			leaf(`c${index}`, 10 + (index % 7), 20, {
				sizingVertical: index % 3 === 0 ? 'FILL' : 'FIXED'
			})
		);
		const root = stack('root', { width: 1, height: 1 }, { wrap: true, itemSpacing: 2 }, children, {
			sizingVertical: 'HUG',
			maxWidth: 800
		});
		const started = performance.now();
		const result = computeLayout(root);
		const elapsed = performance.now() - started;
		expect(result.size).toBe(2001);
		expect(elapsed).toBeLessThan(500);
	});
});

describe('helpers', () => {
	it('distribute splits equally within bounds', () => {
		expect(
			distribute(90, [
				{ min: 0, max: Infinity },
				{ min: 0, max: Infinity }
			])
		).toEqual([45, 45]);
		expect(
			distribute(100, [
				{ min: 0, max: 20 },
				{ min: 0, max: Infinity }
			])
		).toEqual([20, 80]);
		expect(
			distribute(10, [
				{ min: 30, max: Infinity },
				{ min: 0, max: Infinity }
			])
		).toEqual([30, 0]);
	});

	it('breakLines keeps at least one item per line', () => {
		expect(breakLines([40, 40, 40], 100, 10)).toEqual([[0, 1], [2]]);
		expect(breakLines([200, 10], 100, 0)).toEqual([[0], [1]]);
		expect(breakLines([], 100, 0)).toEqual([]);
	});
});
