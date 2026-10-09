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

	it('onto another page or into another file: centres on the viewport, keeps coordinates without one', () => {
		const store = sample();
		const payload = copyOf(store, ['loose']);
		const otherPage = pasteInto(store, payload, { currentPageId: 'q', viewport });
		expect(topLeft(store, otherPage[0])).toEqual([1395, 1295]);
		const otherFile = pasteInto(store, { ...payload, documentId: 'elsewhere' }, { viewport });
		expect(topLeft(store, otherFile[0])).toEqual([1395, 1295]);
		const headless = pasteInto(store, payload, { currentPageId: 'q' });
		expect(topLeft(store, headless[0])).toEqual([600, 600]);
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

	it('paste here puts the top left on the cursor and falls back to the default without one', () => {
		const store = sample();
		const payload = copyOf(store, ['b']);
		const [here] = pasteInto(store, payload, { mode: 'here', cursor: { x: 50, y: 60 } });
		expect(topLeft(store, here)).toEqual([50, 60]);
		const [fallback] = pasteInto(store, payload, { mode: 'here', viewport });
		expect(topLeft(store, fallback)).toEqual([1395, 1295]);
	});

	it('a drop centres the content on the drop point and is never pushed next to anything', () => {
		const store = sample();
		const payload = copyOf(store, ['f']);
		const [dropped] = pasteInto(store, payload, { mode: 'drop', cursor: { x: 1000, y: 1000 } });
		expect(topLeft(store, dropped)).toEqual([800, 800]);
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

describe('paste next to the original', () => {
	const view: Rect = { x: -200, y: -200, width: 2000, height: 1000 };

	function frames(): DocumentStore {
		return storeOf([
			page(
				'Page',
				[
					frame({ id: 'a', name: 'A', transform: at(0, 0), width: 400, height: 300 }),
					frame({ id: 'twin', name: 'Twin', transform: at(0, 600), width: 400, height: 300 }),
					frame({ id: 'other', name: 'Other', transform: at(900, 0), width: 500, height: 200 }),
					frame({ id: 'host', name: 'Host', transform: at(2000, 0), width: 600, height: 400 }, [
						frame({ id: 'inner', name: 'Inner', transform: at(10, 10), width: 100, height: 100 })
					]),
					box('rect', 500, 500, 50, 50)
				],
				{ id: 'p' }
			)
		]);
	}

	it('puts a copy of a top-level frame to the right with a gap of 40, selected or not', () => {
		for (const selection of [[], ['a']]) {
			const store = frames();
			const [pasted] = pasteInto(store, copyOf(store, ['a']), { viewport: view, selection });
			expect(topLeft(store, pasted)).toEqual([440, 0]);
			expect(store.requireNode(pasted).parentId).toBe('p');
		}
	});

	it('repeats: the next copy goes past the previous one and past other frames', () => {
		const store = frames();
		const payload = copyOf(store, ['a']);
		const [first] = pasteInto(store, payload, { viewport: view });
		expect(topLeft(store, first)).toEqual([440, 0]);
		const [second] = pasteInto(store, payload, { viewport: view, selection: [first] });
		expect(topLeft(store, second)).toEqual([1440, 0]);
	});

	it('pushes past every frame it would overlap', () => {
		const store = frames();
		const [pasted] = pasteInto(store, copyOf(store, ['a']), { viewport: view });
		applyTo(store, [{ t: 'del', node: store.requireNode(pasted) }]);
		const [again] = pasteInto(store, copyOf(store, ['other']), { viewport: view });
		expect(topLeft(store, again)).toEqual([1440, 0]);
	});

	it('starts at a selected frame of the same size, which can be elsewhere', () => {
		const store = frames();
		const [pasted] = pasteInto(store, copyOf(store, ['a']), {
			viewport: view,
			selection: ['twin']
		});
		expect(topLeft(store, pasted)).toEqual([440, 600]);
		expect(store.requireNode(pasted).parentId).toBe('p');
	});

	it('keeps pushing from a selected copy after the view moved away from the original', () => {
		const store = frames();
		const payload = copyOf(store, ['a']);
		const [first] = pasteInto(store, payload, { viewport: view });
		const scrolled: Rect = { x: 450, y: -200, width: 2000, height: 1000 };
		const [second] = pasteInto(store, payload, { viewport: scrolled, selection: [first] });
		expect(topLeft(store, second)).toEqual([1440, 0]);
		const nothingSelected = pasteInto(store, payload, { viewport: scrolled });
		expect(topLeft(store, nothingSelected[0])).toEqual([1250, 150]);
	});

	it('does not push rectangles, groups, nested frames, several roots or a frame of another size', () => {
		const store = frames();
		const [rectangle] = pasteInto(store, copyOf(store, ['rect']), { viewport: view });
		expect(topLeft(store, rectangle)).toEqual([500, 500]);
		const around: Rect = { x: 1500, y: -200, width: 2000, height: 1000 };
		const [nested] = pasteInto(store, copyOf(store, ['inner']), { viewport: around });
		expect(topLeft(store, nested)).toEqual([2010, 10]);
		const roots = pasteInto(store, copyOf(store, ['a', 'twin']), { viewport: view });
		expect(topLeft(store, roots[0])).toEqual([0, 0]);
		expect(topLeft(store, roots[1])).toEqual([0, 600]);
	});

	it('does not push when the original is out of view: the copy is centred in the view', () => {
		const store = frames();
		const away: Rect = { x: 5000, y: 5000, width: 1000, height: 800 };
		const [pasted] = pasteInto(store, copyOf(store, ['a']), { viewport: away });
		expect(topLeft(store, pasted)).toEqual([5300, 5250]);
	});

	it('with nothing selected, a copy from inside a frame goes back into that frame while it is in view', () => {
		const store = frames();
		const around: Rect = { x: 1500, y: -200, width: 2000, height: 1000 };
		const [pasted] = pasteInto(store, copyOf(store, ['inner']), { viewport: around });
		expect(store.requireNode(pasted).parentId).toBe('host');
		const away: Rect = { x: 5000, y: 5000, width: 1000, height: 800 };
		const [elsewhere] = pasteInto(store, copyOf(store, ['inner']), { viewport: away });
		expect(store.requireNode(elsewhere).parentId).toBe('p');
	});

	it('pastes into a different frame when another size is selected', () => {
		const store = frames();
		const [pasted] = pasteInto(store, copyOf(store, ['a']), {
			viewport: view,
			selection: ['other']
		});
		expect(store.requireNode(pasted).parentId).toBe('other');
	});
});

describe('paste into a frame', () => {
	const view: Rect = { x: -2000, y: -2000, width: 8000, height: 8000 };

	function framed(): DocumentStore {
		return storeOf([
			page(
				'Page',
				[
					frame({ id: 'f', name: 'F', transform: at(1000, 1000), width: 600, height: 400 }, [
						box('k', 10, 10, 20, 20)
					]),
					box('far', 5000, 5000, 100, 80),
					box('beside', 1100, 5000, 100, 80),
					box('above', 5000, 1100, 100, 80),
					box('wide', 1100, 5000, 800, 80),
					box('inside', 1100, 1100, 100, 80),
					frame({ id: 'g', name: 'G', transform: at(0, 0), width: 300, height: 300 }, [
						box('nested', 50, 50, 100, 80)
					])
				],
				{ id: 'p' }
			)
		]);
	}

	function pastedAt(source: string, overrides: Partial<PasteSettings> = {}): [number, number] {
		const store = framed();
		const [pasted] = pasteInto(store, copyOf(store, [source]), {
			viewport: view,
			selection: ['f'],
			...overrides
		});
		expect(store.requireNode(pasted).parentId).toBe('f');
		return topLeft(store, pasted);
	}

	it('keeps the position when the content touches the frame', () => {
		expect(pastedAt('inside')).toEqual([1100, 1100]);
	});

	it('centres on an axis that misses the frame and keeps one that touches it', () => {
		expect(pastedAt('far')).toEqual([1250, 1160]);
		expect(pastedAt('beside')).toEqual([1100, 1160]);
		expect(pastedAt('above')).toEqual([1250, 1100]);
	});

	it('centres on both axes when the content is wider than the frame', () => {
		expect(pastedAt('wide')).toEqual([900, 1160]);
	});

	it('keeps the offset inside the original parent when it came from another frame', () => {
		expect(pastedAt('nested')).toEqual([1050, 1050]);
	});

	it('centres in the visible part of the frame', () => {
		const half: Rect = { x: 1300, y: 0, width: 2000, height: 2000 };
		expect(pastedAt('far', { viewport: half })).toEqual([1400, 1160]);
	});

	it('pastes onto the page, centred in the view, when the selected frame is out of view', () => {
		const store = framed();
		const away: Rect = { x: 9000, y: 9000, width: 1000, height: 800 };
		const [pasted] = pasteInto(store, copyOf(store, ['far']), { viewport: away, selection: ['f'] });
		expect(store.requireNode(pasted).parentId).toBe('p');
		expect(topLeft(store, pasted)).toEqual([9450, 9360]);
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
