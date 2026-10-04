import { describe, expect, it } from 'vitest';
import {
	createNode,
	sequentialIdGenerator,
	type DocumentStore,
	type NodeId,
	type Rect
} from '../document';
import { frame, node, page } from '../document/fixtures';
import {
	buildPayload,
	decodePayload,
	encodePayload,
	fallbackText,
	type ClipboardPayload
} from './clipboardPayload';
import { applyTo, at, box, orderOf, storeOf } from './fixtures/editingFixture';
import {
	buildImageNode,
	buildTextNode,
	planPaste,
	planPasteNode,
	type PasteSettings
} from './paste';

function sample(): DocumentStore {
	return storeOf([
		page(
			'Page',
			[
				frame({ id: 'f', name: 'F', transform: at(100, 100), width: 400, height: 400 }, [
					box('a', 0, 0),
					box('b', 20, 20),
					box('c', 40, 40)
				]),
				frame({ id: 'small', name: 'Small', transform: at(700, 0), width: 15, height: 15 }),
				box('loose', 600, 600)
			],
			{ id: 'p' }
		),
		page('Other', [], { id: 'q' })
	]);
}

function settings(overrides: Partial<PasteSettings> = {}): PasteSettings {
	return {
		mode: 'default',
		documentId: 'fixture-document',
		currentPageId: 'p',
		selection: [],
		viewport: null,
		cursor: null,
		...overrides
	};
}

function copyOf(store: DocumentStore, ids: NodeId[]): ClipboardPayload {
	const payload = buildPayload(store, ids);
	if (payload === null) throw new Error('nothing to copy');
	return payload;
}

let pasteCount = 0;

function pasteInto(
	store: DocumentStore,
	payload: ClipboardPayload,
	overrides: Partial<PasteSettings>
): NodeId[] {
	const plan = planPaste(
		store,
		payload,
		settings(overrides),
		sequentialIdGenerator(`new${(pasteCount += 1)}_`)
	);
	applyTo(store, plan.changes);
	return plan.newRootIds;
}

function topLeft(store: DocumentStore, id: NodeId): [number, number] {
	const bounds = store.cache.absoluteBounds(id);
	return [bounds.x, bounds.y];
}

describe('clipboard payload', () => {
	it('copies roots in z-order with their subtrees, positions and the entities they use', () => {
		const store = sample();
		const payload = buildPayload(store, ['loose', 'f', 'a']);
		expect(payload?.roots.map((root) => root.id)).toEqual(['f', 'loose']);
		expect(payload?.nodes.map((entry) => entry.id)).toEqual(['f', 'a', 'b', 'c', 'loose']);
		expect(payload?.bounds).toMatchObject({ x: 100, y: 100, width: 510, height: 510 });
		expect(payload?.parentOrigin).toEqual({ x: 0, y: 0 });
		expect(buildPayload(store, ['p'])).toBeNull();
	});

	it('round-trips through the html carrier and rejects foreign or damaged html', () => {
		const payload = buildPayload(sample(), ['a']);
		if (payload === null) throw new Error('no payload');
		const html = encodePayload(payload);
		expect(decodePayload(html)).toEqual(payload);
		expect(decodePayload('<b>hello</b>')).toBeNull();
		expect(decodePayload(null)).toBeNull();
		expect(decodePayload('<span data-design-clone="e30="></span>')).toBeNull();
		expect(decodePayload('<span data-design-clone="!!!"></span>')).toBeNull();
	});

	it('survives non-ascii names', () => {
		const store = storeOf([page('P', [box('a', 0, 0)], { id: 'p' })]);
		applyTo(store, [{ t: 'set', id: 'a', set: { name: 'Größe 設計' }, prev: { name: 'a' } }]);
		const payload = copyOf(store, ['a']);
		const decoded = decodePayload(encodePayload(payload));
		expect(decoded?.nodes[0].name).toBe('Größe 設計');
		expect(fallbackText(payload)).toBe('Größe 設計');
	});

	it('carries bound variables, their collections and image assets', () => {
		const store = sample();
		applyTo(store, [
			{
				t: 'entity-add',
				kind: 'collection',
				entity: {
					id: 'col',
					name: 'Tokens',
					modes: [{ modeId: 'm', name: 'Light' }],
					defaultModeId: 'm',
					variableIds: ['var']
				}
			},
			{
				t: 'entity-add',
				kind: 'variable',
				entity: {
					id: 'var',
					name: 'size',
					collectionId: 'col',
					resolvedType: 'FLOAT',
					valuesByMode: { m: 4 },
					scopes: [],
					codeSyntax: {},
					description: ''
				}
			},
			{
				t: 'set',
				id: 'a',
				set: { boundVariables: { width: { type: 'VARIABLE_ALIAS', id: 'var' } } },
				prev: {}
			}
		]);
		const payload = buildPayload(store, ['a']);
		expect(payload?.entities.variables.map((entity) => entity.id)).toEqual(['var']);
		expect(payload?.entities.collections.map((entity) => entity.id)).toEqual(['col']);
		expect(buildPayload(store, ['b'])?.entities.variables).toEqual([]);
	});
});

describe('paste placement', () => {
	const viewport: Rect = { x: 1000, y: 1000, width: 800, height: 600 };

	it('onto the page: keeps the position while the original is in view, else centres on the viewport', () => {
		const store = sample();
		const payload = copyOf(store, ['loose']);
		const inView = pasteInto(store, payload, {
			viewport: { x: 500, y: 500, width: 400, height: 400 }
		});
		expect(topLeft(store, inView[0])).toEqual([600, 600]);
		const away = pasteInto(store, payload, { viewport });
		expect(topLeft(store, away[0])).toEqual([1395, 1295]);
		expect(store.requireNode(away[0]).parentId).toBe('p');
	});

	it('onto another page or into another file: keeps the original coordinates', () => {
		const store = sample();
		const payload = copyOf(store, ['loose']);
		const otherPage = pasteInto(store, payload, { currentPageId: 'q', viewport });
		expect(topLeft(store, otherPage[0])).toEqual([600, 600]);
		const otherFile = pasteInto(store, { ...payload, documentId: 'elsewhere' }, { viewport });
		expect(topLeft(store, otherFile[0])).toEqual([600, 600]);
	});

	it('into a selected frame: same relative coordinates, on top, centred when they do not fit', () => {
		const store = sample();
		const payload = copyOf(store, ['loose']);
		const nested = copyOf(store, ['b']);
		const [fits] = pasteInto(store, nested, { selection: ['f'] });
		expect(store.requireNode(fits).parentId).toBe('f');
		expect(topLeft(store, fits)).toEqual([120, 120]);
		expect(orderOf(store, 'f').at(-1)).toBe(fits);
		const [centred] = pasteInto(store, payload, { selection: ['f'] });
		expect(topLeft(store, centred)).toEqual([100 + 195, 100 + 195]);
	});

	it('with a non-container selected: into its parent right above it', () => {
		const store = sample();
		const payload = copyOf(store, ['c']);
		const [pasted] = pasteInto(store, payload, { selection: ['a'] });
		expect(orderOf(store, 'f')).toEqual(['a', pasted, 'b', 'c']);
		expect(topLeft(store, pasted)).toEqual([140, 140]);
	});

	it('paste over selection keeps the relative position even when it does not fit', () => {
		const store = sample();
		const payload = copyOf(store, ['loose']);
		const [pasted] = pasteInto(store, payload, { selection: ['small'], mode: 'over-selection' });
		expect(store.requireNode(pasted).parentId).toBe('small');
		expect(topLeft(store, pasted)).toEqual([700 + 600, 0 + 600]);
	});

	it('paste in place uses the copied absolute position whatever the target', () => {
		const store = sample();
		const payload = copyOf(store, ['b']);
		const [pasted] = pasteInto(store, payload, { selection: ['small'], mode: 'in-place' });
		expect(store.requireNode(pasted).parentId).toBe('small');
		expect(topLeft(store, pasted)).toEqual([120, 120]);
	});

	it('paste here centres on the cursor and falls back to the default without one', () => {
		const store = sample();
		const payload = copyOf(store, ['b']);
		const [here] = pasteInto(store, payload, { mode: 'here', cursor: { x: 50, y: 60 } });
		expect(topLeft(store, here)).toEqual([45, 55]);
		const [fallback] = pasteInto(store, payload, { mode: 'here', viewport });
		expect(topLeft(store, fallback)).toEqual([1395, 1295]);
	});

	it('paste to replace removes the selection, takes its z-position and centres on it', () => {
		const store = sample();
		const payload = copyOf(store, ['loose']);
		const [pasted] = pasteInto(store, payload, { selection: ['b'], mode: 'replace' });
		expect(orderOf(store, 'f')).toEqual(['a', pasted, 'c']);
		expect(store.hasNode('b')).toBe(false);
		expect(topLeft(store, pasted)).toEqual([120 + 5 - 5, 120 + 5 - 5]);
	});

	it('replace does nothing when every selected node is locked or nothing is selected', () => {
		const store = sample();
		applyTo(store, [{ t: 'set', id: 'b', set: { locked: true }, prev: { locked: false } }]);
		const payload = copyOf(store, ['loose']);
		expect(
			planPaste(store, payload, settings({ selection: ['b'], mode: 'replace' })).changes
		).toEqual([]);
	});
});

describe('pasted nodes', () => {
	it('get fresh ids, keep names and structure', () => {
		const store = sample();
		const payload = copyOf(store, ['f']);
		const before = JSON.stringify(store.document.nodes);
		const [pasted] = pasteInto(store, payload, {
			currentPageId: 'p',
			viewport: { x: 5000, y: 0, width: 100, height: 100 }
		});
		expect(pasted).toMatch(/^new\d+_1$/);
		expect(store.requireNode(pasted).name).toBe('F');
		expect(store.childNodes(pasted).map((child) => child.name)).toEqual(['a', 'b', 'c']);
		expect(store.childNodes(pasted).every((child) => child.id.startsWith('new'))).toBe(true);
		expect(JSON.stringify(store.document.nodes)).not.toBe(before);
	});

	it('copies of a component become new components; instances stay linked', () => {
		const store = storeOf([
			page(
				'P',
				[
					node('COMPONENT', { id: 'comp', name: 'C', width: 20, height: 20 }, [box('inner', 0, 0)]),
					node('INSTANCE', { id: 'inst', name: 'I', mainComponentId: 'comp' })
				],
				{ id: 'p' }
			)
		]);
		const component = pasteInto(store, copyOf(store, ['comp']), {});
		expect(store.getNode(component[0])).toMatchObject({ type: 'COMPONENT', key: component[0] });
		const instance = pasteInto(store, copyOf(store, ['inst']), {});
		expect(store.getNode(instance[0])).toMatchObject({ type: 'INSTANCE', mainComponentId: 'comp' });
	});

	it('copying component and instance together relinks the copy to the copied component', () => {
		const store = storeOf([
			page(
				'P',
				[
					node('COMPONENT', { id: 'comp', name: 'C' }),
					node('INSTANCE', { id: 'inst', name: 'I', mainComponentId: 'comp' })
				],
				{ id: 'p' }
			)
		]);
		const [copiedComponent, copiedInstance] = pasteInto(store, copyOf(store, ['comp', 'inst']), {});
		expect(store.getNode(copiedInstance)).toMatchObject({ mainComponentId: copiedComponent });
	});

	it('an instance pasted into a file without its main component becomes a plain frame', () => {
		const source = storeOf([
			page(
				'P',
				[
					node('COMPONENT', { id: 'comp', name: 'C' }, [box('inner', 0, 0)]),
					node('INSTANCE', { id: 'inst', name: 'I', mainComponentId: 'comp' }, [
						box('innerCopy', 0, 0)
					])
				],
				{ id: 'p' }
			)
		]);
		applyTo(source, [{ t: 'set', id: 'innerCopy', set: { componentRef: 'inner' }, prev: {} }]);
		const payload = copyOf(source, ['inst']);
		const destination = storeOf([page('Other', [], { id: 'q' })]);
		const [pasted] = pasteInto(destination, payload, { currentPageId: 'q', documentId: 'else' });
		const result = destination.requireNode(pasted);
		expect(result.type).toBe('FRAME');
		expect(Reflect.get(result, 'mainComponentId')).toBeUndefined();
		const [child] = destination.childNodes(pasted);
		expect(child.componentRef).toBeUndefined();
	});

	it('bring their variables and styles along when the target file lacks them', () => {
		const source = sample();
		applyTo(source, [
			{
				t: 'entity-add',
				kind: 'style',
				entity: { id: 'st', type: 'PAINT', name: 'Brand', description: '', value: [] }
			},
			{ t: 'set', id: 'a', set: { fillStyleId: 'st' }, prev: {} }
		]);
		const payload = copyOf(source, ['a']);
		const destination = storeOf([page('Other', [], { id: 'q' })]);
		pasteInto(destination, payload, { currentPageId: 'q', documentId: 'else' });
		expect(destination.getEntity('style', 'st')).toMatchObject({ name: 'Brand' });
		const again = planPaste(
			destination,
			payload,
			settings({ currentPageId: 'q', documentId: 'else' })
		);
		expect(again.changes.filter((change) => change.t === 'entity-add')).toEqual([]);
	});
});

describe('pasted text and images', () => {
	it('text becomes a text node with one paragraph per line, centred in the target frame', () => {
		const store = sample();
		const textNode = buildTextNode('one\ntwo');
		const plan = planPasteNode(
			store,
			textNode,
			settings({ selection: ['f'] }),
			[],
			sequentialIdGenerator('t')
		);
		applyTo(store, plan.changes);
		const created = store.requireNode(plan.newRootIds[0]);
		expect(created).toMatchObject({ type: 'TEXT', name: 'one', parentId: 'f' });
		if (created.type !== 'TEXT') throw new Error('not text');
		expect(created.paragraphs).toHaveLength(2);
		const bounds = store.cache.absoluteBounds(created.id);
		expect(bounds.x + bounds.width / 2).toBeCloseTo(300);
		expect(bounds.y + bounds.height / 2).toBeCloseTo(300);
	});

	it('an image becomes a rectangle with an image fill, shrunk to fit the viewport, on the cursor for paste here', () => {
		const store = sample();
		const viewport: Rect = { x: 0, y: 0, width: 200, height: 100 };
		const node = buildImageNode({ hash: 'h', width: 400, height: 100 }, viewport);
		expect(node).toMatchObject({ width: 180, height: 45 });
		const plan = planPasteNode(
			store,
			node,
			settings({ mode: 'here', cursor: { x: 1000, y: 1000 }, viewport }),
			[],
			sequentialIdGenerator('i')
		);
		applyTo(store, plan.changes);
		const created = store.requireNode(plan.newRootIds[0]);
		expect(Reflect.get(created, 'fills')).toMatchObject([
			{ type: 'IMAGE', imageHash: 'h', scaleMode: 'FILL' }
		]);
		expect(topLeft(store, created.id)).toEqual([910, 977.5]);
		expect(createNode('RECTANGLE').type).toBe('RECTANGLE');
	});
});
