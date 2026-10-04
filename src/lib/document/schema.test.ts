import { describe, expect, expectTypeOf, it } from 'vitest';
import { createNode } from './defaults';
import { DERIVED_FIELD_NAMES, type DerivedFieldName } from './derived';
import { parseChange, parseDesignDocument, parseNode, parseTransaction } from './schema';
import {
	NODE_TYPES,
	SCHEMA_VERSION,
	type Change,
	type DesignDocument,
	type Node,
	type NodeType,
	type SceneNode,
	type Transaction
} from './types';

function expectValid(input: unknown): void {
	const result = parseNode(input);
	if (!result.ok) throw new Error(result.message);
}

function expectInvalid(input: unknown): void {
	expect(parseNode(input).ok).toBe(false);
}

describe('node schema, one valid fixture per node type', () => {
	for (const type of NODE_TYPES) {
		it(`accepts a default ${type}`, () => {
			expectValid(createNode(type, { id: `${type}-1` }));
		});
	}

	it('round-trips through JSON unchanged', () => {
		for (const type of NODE_TYPES) {
			const node = createNode(type, { id: 'n' });
			const parsed = parseNode(JSON.parse(JSON.stringify(node)));
			expect(parsed).toEqual({ ok: true, value: node });
		}
	});
});

describe('node schema, invalid fixtures', () => {
	const invalidByType: Record<NodeType, Record<string, unknown>> = {
		PAGE: { parentId: 'not-null' },
		FRAME: { clipsContent: 'yes' },
		GROUP: { opacity: 2 },
		SECTION: { sectionContentsHidden: 1 },
		RECTANGLE: { cornerRadius: -1 },
		ELLIPSE: { arcData: { startingAngle: 0, endingAngle: 1, innerRadius: 5 } },
		LINE: { strokes: [{ weight: 1 }] },
		POLYGON: { pointCount: 2 },
		STAR: { innerRadius: -0.5 },
		VECTOR: { network: { vertices: [], segments: [{ start: -1, end: 0 }] } },
		TEXT: { paragraphs: [] },
		BOOLEAN_OPERATION: { booleanOperation: 'XOR' },
		COMPONENT: { componentPropertyDefinitions: { a: { type: 'NOPE', defaultValue: true } } },
		COMPONENT_SET: { key: 5 },
		INSTANCE: { mainComponentId: '' },
		SLICE: { width: -3 }
	};

	for (const type of NODE_TYPES) {
		it(`rejects a ${type} with a bad property`, () => {
			expectInvalid({ ...createNode(type), ...invalidByType[type] });
		});

		it(`rejects a ${type} with a missing required property`, () => {
			const { name: _name, ...withoutName } = createNode(type);
			expectInvalid(withoutName);
		});
	}

	it('rejects an unknown node type', () => {
		expectInvalid({ ...createNode('FRAME'), type: 'DOCUMENT' });
	});

	it('rejects derived fields on persisted nodes', () => {
		expectInvalid({
			...createNode('RECTANGLE'),
			absoluteTransform: [
				[1, 0, 0],
				[0, 1, 0]
			]
		});
		expectInvalid({ ...createNode('TEXT'), textLayout: {} });
	});

	it('rejects colors outside 0..1', () => {
		const node = createNode('RECTANGLE', {
			fills: [
				{
					type: 'SOLID',
					visible: true,
					opacity: 1,
					blendMode: 'NORMAL',
					color: { r: 255, g: 0, b: 0 }
				}
			]
		});
		expectInvalid(node);
	});

	it('rejects non-finite numbers', () => {
		expectInvalid({ ...createNode('RECTANGLE'), width: Number.POSITIVE_INFINITY });
		expectInvalid({ ...createNode('RECTANGLE'), width: Number.NaN });
	});

	it('rejects unknown touched groups', () => {
		expectInvalid({ ...createNode('RECTANGLE'), touched: ['fills', 'sparkles'] });
	});

	it('reports a readable message', () => {
		const result = parseNode({ ...createNode('FRAME'), width: -1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('width');
	});
});

describe('component and variable fields', () => {
	it('accepts instance children with componentRef and touched', () => {
		expectValid(
			createNode('RECTANGLE', { componentRef: 'main-rect', touched: ['fills', 'geometry'] })
		);
	});

	it('accepts boundVariables and explicitVariableModes', () => {
		expectValid(
			createNode('FRAME', {
				boundVariables: { paddingTop: { type: 'VARIABLE_ALIAS', id: 'v1' } },
				explicitVariableModes: { collection1: 'mode2' }
			})
		);
		expectValid(createNode('PAGE', { explicitVariableModes: { collection1: 'mode2' } }));
	});

	it('accepts pluginData namespaced by plugin id', () => {
		expectValid(createNode('FRAME', { pluginData: { 'my.plugin': { key: 'value' } } }));
		expectInvalid({ ...createNode('FRAME'), pluginData: { 'my.plugin': { key: 1 } } });
	});

	it('accepts a text run with a style delta and variable binding', () => {
		const text = createNode('TEXT', {
			paragraphs: [
				{
					runs: [
						{
							text: 'hi',
							style: {
								fontSize: 20,
								boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'v' } }
							}
						}
					],
					align: 'LEFT',
					indent: 0,
					spacingAfter: 0,
					list: 'NONE',
					listLevel: 0
				}
			]
		});
		expectValid(text);
	});
});

describe('change and transaction schema', () => {
	const frame = createNode('FRAME', { id: 'f1', parentId: 'p1' });

	const validChanges: Change[] = [
		{ t: 'add', node: frame },
		{ t: 'del', node: frame },
		{ t: 'set', id: 'f1', set: { name: 'b' }, prev: { name: 'a' } },
		{ t: 'move', id: 'f1', parent: 'p2', index: 'a1', prevParent: 'p1', prevIndex: 'a0' },
		{ t: 'move', id: 'page', parent: null, index: 'a1', prevParent: null, prevIndex: 'a0' },
		{
			t: 'entity-add',
			kind: 'variable',
			entity: {
				id: 'v1',
				name: 'gap',
				collectionId: 'c1',
				resolvedType: 'FLOAT',
				valuesByMode: { m1: 4 },
				scopes: [],
				codeSyntax: {},
				description: ''
			}
		},
		{
			t: 'entity-add',
			kind: 'collection',
			entity: {
				id: 'c1',
				name: 'Spacing',
				modes: [{ modeId: 'm1', name: 'Default' }],
				defaultModeId: 'm1',
				variableIds: []
			}
		},
		{
			t: 'entity-del',
			kind: 'style',
			entity: { id: 's1', type: 'PAINT', name: 'Brand', description: '', value: {} }
		},
		{ t: 'entity-add', kind: 'asset', entity: { id: 'abc123', mime: 'image/png' } },
		{ t: 'entity-set', kind: 'style', id: 's1', set: { name: 'x' }, prev: { name: 'y' } }
	];

	for (const change of validChanges) {
		it(`accepts ${JSON.stringify(change).slice(0, 40)}`, () => {
			expect(parseChange(change).ok).toBe(true);
		});
	}

	it('rejects an unknown change type', () => {
		expect(parseChange({ t: 'explode', id: 'x' }).ok).toBe(false);
	});

	it('rejects a set without prev', () => {
		expect(parseChange({ t: 'set', id: 'f1', set: { name: 'b' } }).ok).toBe(false);
	});

	it('rejects an entity change whose entity does not match its kind', () => {
		const result = parseChange({
			t: 'entity-add',
			kind: 'variable',
			entity: { id: 's1', type: 'PAINT', name: 'Brand', description: '', value: {} }
		});
		expect(result.ok).toBe(false);
	});

	it('rejects an add carrying an invalid node', () => {
		expect(parseChange({ t: 'add', node: { ...frame, width: -5 } }).ok).toBe(false);
	});

	it('validates a transaction with all four origins', () => {
		for (const origin of ['user', 'plugin', 'ai', 'sync'] as const) {
			const transaction: Transaction = {
				id: 't1',
				origin,
				label: 'Move',
				changes: [validChanges[2]],
				undo: [validChanges[2]],
				mergeKey: 'nudge'
			};
			expect(parseTransaction(transaction).ok).toBe(true);
		}
		expect(
			parseTransaction({ id: 't', origin: 'robot', label: '', changes: [], undo: [] }).ok
		).toBe(false);
	});
});

describe('design document schema', () => {
	function emptyDocument(): DesignDocument {
		const page = createNode('PAGE', { id: 'page1' });
		const frame = createNode('FRAME', { id: 'frame1', parentId: 'page1' });
		return {
			schemaVersion: SCHEMA_VERSION,
			id: 'doc1',
			name: 'Untitled',
			nodes: { page1: page, frame1: frame },
			styles: {},
			variableCollections: {},
			variables: {},
			assets: {},
			fonts: [{ family: 'Inter', style: 'Regular', source: 'system' }]
		};
	}

	it('accepts a small document', () => {
		expect(parseDesignDocument(emptyDocument()).ok).toBe(true);
	});

	it('rejects a document containing a bad node', () => {
		const document = emptyDocument();
		document.nodes.frame1 = { ...document.nodes.frame1, width: -1 } as SceneNode;
		expect(parseDesignDocument(document).ok).toBe(false);
	});
});

describe('type-level: persisted nodes contain no derived fields', () => {
	it('shares no key with the derived field names', () => {
		type AllNodeKeys = Node extends infer N ? (N extends Node ? keyof N : never) : never;
		expectTypeOf<Extract<AllNodeKeys, DerivedFieldName>>().toEqualTypeOf<never>();
		expect(DERIVED_FIELD_NAMES.length).toBeGreaterThan(0);
	});

	it('node default values carry no derived key at runtime', () => {
		for (const type of NODE_TYPES) {
			const keys = Object.keys(createNode(type));
			for (const name of DERIVED_FIELD_NAMES) expect(keys).not.toContain(name);
		}
	});
});
