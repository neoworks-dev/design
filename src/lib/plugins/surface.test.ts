import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	applySurfacePatch,
	diffSurface,
	MAX_SURFACE_DEPTH,
	MAX_SURFACE_NODES,
	validateSurface,
	type SurfaceNode,
	type TextNode,
	type UiHandler
} from './surface';
import { toWireTree } from './worker/ui';

const text = (value: string): TextNode => ({ type: 'text', text: value });
const stack = (...children: SurfaceNode[]): SurfaceNode => ({ type: 'stack', children });

function expectInvalid(raw: unknown): string {
	const result = validateSurface(raw);
	if (result.ok) throw new Error('expected the tree to be rejected');
	return result.error;
}

describe('validateSurface', () => {
	it('accepts every node type', () => {
		const tree = {
			type: 'stack',
			direction: 'column',
			gap: 'md',
			children: [
				{ type: 'section', title: 'Grid', children: [text('hello')] },
				{ type: 'divider' },
				{ type: 'button', label: 'Go', variant: 'primary', onClick: '1:onClick' },
				{ type: 'input', label: 'Name', value: 'a', inputType: 'text', onChange: '2:onChange' },
				{ type: 'input', value: '3', inputType: 'number', min: 1, max: 9 },
				{
					type: 'select',
					value: 'a',
					options: [
						{ value: 'a', label: 'A' },
						{ value: 'b', label: 'B' }
					]
				},
				{ type: 'color', value: '#aabbcc' },
				{ type: 'checkbox', label: 'On', checked: true },
				{ type: 'list', children: [text('one'), text('two')] },
				{ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'dot' },
				{
					type: 'tabs',
					value: 'one',
					children: [
						{ type: 'tab', id: 'one', label: 'One', children: [text('first')] },
						{ type: 'tab', id: 'two', label: 'Two', children: [] }
					]
				}
			]
		};
		expect(validateSurface(tree)).toEqual({ ok: true, tree });
	});

	it('fails closed on an unknown node type, naming where it is', () => {
		const error = expectInvalid(
			stack(text('ok'), { type: 'iframe', src: 'https://evil' } as never)
		);
		expect(error).toBe('unknown node type "iframe" at children[1]');
	});

	it('rejects unknown properties instead of passing them on', () => {
		expect(expectInvalid({ type: 'text', text: 'x', onclick: 'alert(1)' })).toContain('onclick');
		expect(expectInvalid({ type: 'button', label: 'x', style: 'color:red' })).toContain('style');
	});

	it('rejects a tab outside tabs and a non-tab inside tabs', () => {
		expect(expectInvalid({ type: 'tab', id: 'a', label: 'A', children: [] })).toBeTruthy();
		expect(expectInvalid({ type: 'tabs', children: [text('nope')] })).toBeTruthy();
	});

	it('only accepts inline images and hex colors', () => {
		expect(
			expectInvalid({ type: 'image', src: 'https://example.com/a.png', alt: 'x' })
		).toBeTruthy();
		expect(expectInvalid({ type: 'image', src: 'file:///etc/passwd', alt: 'x' })).toBeTruthy();
		expect(
			expectInvalid({ type: 'image', src: 'data:text/html;base64,AAAA', alt: 'x' })
		).toBeTruthy();
		expect(expectInvalid({ type: 'color', value: 'red' })).toBeTruthy();
	});

	it('rejects non-objects and a missing root', () => {
		expect(expectInvalid(null)).toContain('not a node');
		expect(expectInvalid('stack')).toContain('not a node');
		expect(expectInvalid([text('x')])).toContain('not a node');
	});

	it('refuses trees that are too deep or too big', () => {
		let deep: SurfaceNode = text('bottom');
		for (let level = 0; level < MAX_SURFACE_DEPTH + 2; level += 1) deep = stack(deep);
		expect(expectInvalid(deep)).toContain('deeper than');
		const wide = stack(...Array.from({ length: MAX_SURFACE_NODES + 1 }, () => text('x')));
		expect(expectInvalid(wide)).toContain('more than');
	});
});

describe('toWireTree', () => {
	it('turns handler functions into position based ids and keeps the functions aside', () => {
		const handlers = new Map<string, UiHandler>();
		const click = (): void => {};
		const wire = toWireTree(
			{
				type: 'stack',
				children: [text('t'), { type: 'button', label: 'Go', onClick: click }]
			},
			handlers
		);
		expect(wire).toEqual({
			type: 'stack',
			children: [text('t'), { type: 'button', label: 'Go', onClick: '1:onClick' }]
		});
		expect(handlers.get('1:onClick')).toBe(click);
		expect(validateSurface(wire).ok).toBe(true);
	});
});

describe('surface patches', () => {
	it('is empty for equal trees', () => {
		expect(diffSurface(stack(text('a')), stack(text('a')))).toEqual([]);
	});

	it('changes only the props that differ', () => {
		const ops = diffSurface(stack(text('a'), text('b')), stack(text('a'), text('c')));
		expect(ops).toEqual([{ op: 'props', path: [1], set: { text: 'c' }, unset: [] }]);
	});

	it('replaces a node whose type changed, inserts and removes children', () => {
		const ops = diffSurface(
			stack(text('a'), text('gone'), text('gone too')),
			stack({ type: 'divider' }, text('b'))
		);
		expect(ops).toEqual([
			{ op: 'replace', path: [0], node: { type: 'divider' } },
			{ op: 'props', path: [1], set: { text: 'b' }, unset: [] },
			{ op: 'remove', path: [], index: 2 }
		]);
		const grown = diffSurface(stack(), stack(text('x'), text('y')));
		expect(grown).toEqual([
			{ op: 'insert', path: [], index: 0, node: text('x') },
			{ op: 'insert', path: [], index: 1, node: text('y') }
		]);
	});

	it('unsets props the new node no longer has', () => {
		const before: SurfaceNode = { type: 'button', label: 'Go', disabled: true };
		const after: SurfaceNode = { type: 'button', label: 'Go' };
		const ops = diffSurface(before, after);
		expect(ops).toEqual([{ op: 'props', path: [], set: {}, unset: ['disabled'] }]);
		expect(applySurfacePatch(before, ops)).toEqual(after);
	});

	it('does not touch the tree it patches', () => {
		const before = stack(text('a'));
		const copy = structuredClone(before);
		applySurfacePatch(before, diffSurface(before, stack(text('b'))));
		expect(before).toEqual(copy);
	});

	it('throws when a patch addresses a node that is not there', () => {
		expect(() =>
			applySurfacePatch(stack(text('a')), [{ op: 'props', path: [5], set: {}, unset: [] }])
		).toThrow('no node at');
		expect(() =>
			applySurfacePatch(text('a'), [{ op: 'insert', path: [], index: 0, node: text('b') }])
		).toThrow('cannot have children');
	});

	const nodeArbitrary = fc.letrec<{ node: SurfaceNode; tab: SurfaceNode }>((tie) => ({
		node: fc.oneof(
			{ depthSize: 'small', maxDepth: 4 },
			fc.string({ maxLength: 8 }).map((value): SurfaceNode => ({ type: 'text', text: value })),
			fc.constant<SurfaceNode>({ type: 'divider' }),
			fc
				.record({ label: fc.string({ maxLength: 8 }), disabled: fc.boolean() })
				.map(({ label, disabled }): SurfaceNode => ({ type: 'button', label, disabled })),
			fc
				.record({ label: fc.string({ maxLength: 8 }) })
				.map(({ label }): SurfaceNode => ({ type: 'button', label })),
			fc
				.array(tie('node'), { maxLength: 4 })
				.map((children): SurfaceNode => ({ type: 'stack', children: children as SurfaceNode[] })),
			fc
				.tuple(fc.string({ maxLength: 6 }), fc.array(tie('node'), { maxLength: 3 }))
				.map(([title, children]): SurfaceNode => ({
					type: 'section',
					title,
					children: children as SurfaceNode[]
				})),
			fc
				.array(tie('node'), { maxLength: 3 })
				.map((children): SurfaceNode => ({ type: 'list', children: children as SurfaceNode[] }))
		),
		tab: fc.constant<SurfaceNode>({ type: 'divider' })
	})).node;

	it('round trips: applying diff(a, b) to a gives b, for any two trees', () => {
		fc.assert(
			fc.property(nodeArbitrary, nodeArbitrary, (before, after) => {
				const ops = diffSurface(before, after);
				expect(applySurfacePatch(before, ops)).toEqual(after);
			}),
			{ numRuns: 300 }
		);
	});

	it('produces patches whose result still validates', () => {
		fc.assert(
			fc.property(nodeArbitrary, nodeArbitrary, (before, after) => {
				const patched = applySurfacePatch(before, diffSurface(before, after));
				expect(validateSurface(patched).ok).toBe(true);
			}),
			{ numRuns: 100 }
		);
	});
});
