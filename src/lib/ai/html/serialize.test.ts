import { describe, expect, it } from 'vitest';
import { compareSiblings, sequentialIdGenerator, type Node, type NodeId } from '../../document';
import type { TreeSource } from '../tools/serialize';
import { convertSnapshot } from './convert';
import { BLACK, element, font, text, WHITE } from './fixtures';
import { serializeHtml } from './serialize';
import type { ElementSnapshot } from './snapshot';

function sourceOf(nodes: readonly Node[]): TreeSource {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	return {
		get: (id) => byId.get(id),
		resolved: (id) => {
			const node = byId.get(id);
			if (node === undefined) throw new Error(`no node ${id}`);
			return node;
		},
		children: (id) =>
			nodes
				.filter((node) => node.parentId === id)
				.sort(compareSiblings)
				.map((node) => node.id)
	};
}

function nodesOf(roots: ElementSnapshot[]): { nodes: Node[]; rootIds: NodeId[] } {
	return convertSnapshot(
		{ roots, warnings: [], hiddenIds: [] },
		{
			parentId: 'page',
			origin: { x: 40, y: 80 },
			generateId: sequentialIdGenerator('n'),
			variables: { '--surface': 'v1' }
		}
	);
}

describe('nodes to html', () => {
	it('writes auto layout as flexbox, text as p with styled spans and bindings as var()', () => {
		const card = element([0, 0, 240, 100], {
			attributes: { 'data-name': 'Card' },
			sizing: { width: 'fixed', height: 'hug' },
			style: {
				display: 'flex',
				flexDirection: 'column',
				rowGap: 12,
				padding: { top: 16, right: 16, bottom: 16, left: 16 },
				background: WHITE,
				radii: [8, 8, 8, 8],
				shadows: [{ inset: false, color: { ...BLACK, a: 0.1 }, x: 0, y: 4, blur: 12, spread: 0 }]
			},
			variables: { 'background-color': '--surface' },
			children: [
				element([16, 16, 208, 20], {
					sizing: { width: 'fill', height: 'hug' },
					text: {
						box: { x: 16, y: 16, width: 100, height: 20 },
						lines: 1,
						paragraphs: [
							[
								{ text: 'Hello ', font: font() },
								{ text: 'world', font: font({ weight: 700 }) }
							]
						]
					}
				})
			]
		});
		const { nodes, rootIds } = nodesOf([card]);
		const html = serializeHtml(sourceOf(nodes), rootIds, { cssNames: { v1: '--surface' } });
		expect(html).toContain('data-id="n1" data-name="Card" data-x="40" data-y="80"');
		expect(html).toContain('display:flex;flex-direction:column;gap:12px;padding:16px');
		expect(html).toContain('background-color:var(--surface)');
		expect(html).toContain('border-radius:8px');
		expect(html).toContain('box-shadow:0 4px 12px 0 rgba(0, 0, 0, 0.1)');
		expect(html).toContain('align-self:stretch');
		expect(html).toMatch(
			/<p [^>]*>Hello <span style="[^"]*font-weight:700[^"]*">world<\/span><\/p>/
		);
	});

	it('positions children of frames without auto layout absolutely', () => {
		const frame = element([0, 0, 200, 100], {
			attributes: { 'data-name': 'Free' },
			children: [
				element([10, 20, 30, 30], { style: { background: BLACK } }),
				element([20, 30, 30, 30], { style: { background: WHITE } })
			]
		});
		const { nodes, rootIds } = nodesOf([frame]);
		const html = serializeHtml(sourceOf(nodes), rootIds);
		expect(html).toContain('position:relative');
		expect(html).toContain('position:absolute;left:10px;top:20px;width:30px;height:30px');
	});

	it('summarises what is below the depth limit', () => {
		const nested = element([0, 0, 100, 100], {
			children: [element([0, 0, 50, 50], { children: [element([0, 0, 10, 10])] })]
		});
		const { nodes, rootIds } = nodesOf([nested]);
		const html = serializeHtml(sourceOf(nodes), rootIds, { depth: 1 });
		expect(html).toContain('data-children="1"');
		expect(html).not.toContain('data-id="n3"');
	});

	it('writes text that hugs its content as nowrap without a width', () => {
		const label = element([0, 0, 50, 20], {
			sizing: { width: 'hug', height: 'hug' },
			text: text('Label', [0, 0, 50, 20])
		});
		const { nodes, rootIds } = nodesOf([label]);
		const html = serializeHtml(sourceOf(nodes), rootIds);
		expect(html).toContain('white-space:nowrap');
		expect(html).toContain('width:fit-content');
		expect(html).not.toMatch(/width:\d/);
	});
});
