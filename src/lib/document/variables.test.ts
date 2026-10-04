import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { defaultTextStyle } from './defaults';
import { planEntityAdd, planEntitySet, planSetProps } from './changes';
import { buildDocument, frame, page, rectangle, text } from './fixtures';
import { DocumentStore } from './store';
import type {
	Change,
	RGBA,
	Variable,
	VariableAlias,
	VariableCollection,
	VariableValue
} from './types';
import {
	AliasCycleError,
	InvalidAliasError,
	VariableResolver,
	validateVariableChanges
} from './variables';

const red: RGBA = { r: 1, g: 0, b: 0, a: 1 };
const blue: RGBA = { r: 0, g: 0, b: 1, a: 1 };

const alias = (id: string): VariableAlias => ({ type: 'VARIABLE_ALIAS', id });

function variable(
	id: string,
	collectionId: string,
	resolvedType: Variable['resolvedType'],
	valuesByMode: Record<string, VariableValue>
): Variable {
	return {
		id,
		name: id,
		collectionId,
		resolvedType,
		valuesByMode,
		scopes: [],
		codeSyntax: {},
		description: ''
	};
}

function collection(id: string, modes: string[], variableIds: string[]): VariableCollection {
	return {
		id,
		name: id,
		modes: modes.map((modeId) => ({ modeId, name: modeId })),
		defaultModeId: modes[0],
		variableIds
	};
}

// n1 page P
//   n2 frame LIGHT: n3 rect R (width -> gap, fill color -> accent), n4 rect PLAIN (unbound)
//   n5 frame DARK (modes theme=dark): n6 rect R2 (same bindings), n7 frame INNER: n8 rect R3
//   n9 text T (fontSize -> size), n10 rect E (shadow radius -> gap)
function sampleStore(): DocumentStore {
	const binding = { width: alias('gap') };
	const boundFill = {
		type: 'SOLID' as const,
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL' as const,
		color: { r: 0.5, g: 0.5, b: 0.5 },
		boundVariables: { color: alias('accent') }
	};
	const document = buildDocument([
		page('P', [
			frame({ name: 'LIGHT' }, [
				rectangle({ name: 'R', width: 1, boundVariables: binding, fills: [boundFill] }),
				rectangle({ name: 'PLAIN' })
			]),
			frame({ name: 'DARK', explicitVariableModes: { theme: 'dark' } }, [
				rectangle({ name: 'R2', width: 1, boundVariables: binding, fills: [boundFill] }),
				frame({ name: 'INNER' }, [rectangle({ name: 'R3', width: 1, boundVariables: binding })])
			]),
			text({ name: 'T', boundVariables: {} }),
			rectangle({
				name: 'E',
				effects: [
					{
						type: 'DROP_SHADOW',
						visible: true,
						color: { r: 0, g: 0, b: 0, a: 1 },
						offset: { x: 0, y: 0 },
						radius: 1,
						spread: 0,
						blendMode: 'NORMAL',
						boundVariables: { radius: alias('gap') }
					}
				]
			})
		])
	]);
	document.variableCollections = {
		theme: collection('theme', ['light', 'dark'], ['gap', 'brand', 'accent']),
		size: collection('size', ['s', 'l'], ['size', 'sizeAlias'])
	};
	document.variables = {
		gap: variable('gap', 'theme', 'FLOAT', { light: 8, dark: 16 }),
		brand: variable('brand', 'theme', 'COLOR', { light: red, dark: blue }),
		accent: variable('accent', 'theme', 'COLOR', {
			light: alias('brand'),
			dark: alias('brand')
		}),
		size: variable('size', 'size', 'FLOAT', { s: 12, l: 20 }),
		sizeAlias: variable('sizeAlias', 'size', 'FLOAT', { s: alias('gap'), l: alias('size') })
	};
	return new DocumentStore(document);
}

function widthOf(resolver: VariableResolver, id: string): unknown {
	return resolver.resolve(id, 'width');
}

function fillColor(resolver: VariableResolver, id: string): unknown {
	const node = resolver.resolvedNode(id);
	if (!('fills' in node)) return undefined;
	const fill = node.fills[0];
	if (fill.type !== 'SOLID') return undefined;
	return { color: fill.color, opacity: fill.opacity };
}

describe('resolution', () => {
	it('replaces bound properties with the default mode value, follows aliases, keeps the rest', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		expect(widthOf(resolver, 'n3')).toBe(8);
		expect(fillColor(resolver, 'n3')).toEqual({ color: { r: 1, g: 0, b: 0 }, opacity: 1 });
		const resolved = resolver.resolvedNode('n3');
		expect(resolved).toMatchObject({ name: 'R', height: 100 });
	});

	it('never mutates the stored node and returns the stored object for unbound nodes', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		const stored = store.requireNode('n3');
		const before = JSON.stringify(stored);
		resolver.resolvedNode('n3');
		expect(store.requireNode('n3')).toBe(stored);
		expect(JSON.stringify(stored)).toBe(before);
		expect(resolver.resolvedNode('n4')).toBe(store.requireNode('n4'));
	});

	it('mode inheritance: an explicit mode on a frame applies to its descendants only', () => {
		const resolver = new VariableResolver(sampleStore());
		expect(widthOf(resolver, 'n3')).toBe(8);
		expect(widthOf(resolver, 'n6')).toBe(16);
		expect(widthOf(resolver, 'n8')).toBe(16);
		expect(fillColor(resolver, 'n6')).toEqual({ color: { r: 0, g: 0, b: 1 }, opacity: 1 });
		expect(resolver.modeFor('theme', 'n8')).toBe('dark');
		expect(resolver.modeFor('theme', 'n3')).toBe('light');
		expect(resolver.modeFor('theme')).toBe('light');
	});

	it('the nearest explicit mode wins, and a mode the collection lacks is ignored', () => {
		const store = sampleStore();
		applyChanges(store, [
			...planSetProps(store, 'n7', { explicitVariableModes: { theme: 'light' } }),
			...planSetProps(store, 'n1', { explicitVariableModes: { theme: 'dark' } }),
			...planSetProps(store, 'n2', { explicitVariableModes: { theme: 'gone' } })
		]);
		const resolver = new VariableResolver(store);
		expect(widthOf(resolver, 'n8')).toBe(8);
		expect(widthOf(resolver, 'n6')).toBe(16);
		expect(widthOf(resolver, 'n3')).toBe(16);
	});

	it('follows an alias in the mode of the target collection for the same node', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		// sizeAlias[s] -> gap (collection theme): the theme mode of the node decides.
		expect(resolver.resolveVariable('sizeAlias', 'n3')).toBe(8);
		expect(resolver.resolveVariable('sizeAlias', 'n6')).toBe(16);
		expect(resolver.resolveVariable('gap')).toBe(8);
	});

	it('a mode without a value falls back to the default mode value', () => {
		const store = sampleStore();
		applyChanges(store, planEntitySet(store, 'variable', 'gap', { valuesByMode: { light: 8 } }));
		const resolver = new VariableResolver(store);
		expect(widthOf(resolver, 'n6')).toBe(8);
	});

	it('resolves bindings on effects, gradient stops and text styles', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		const shadow = resolver.resolvedNode('n10');
		expect('effects' in shadow && shadow.effects[0]).toMatchObject({ radius: 8 });

		applyChanges(store, [
			...planSetProps(store, 'n4', {
				fills: [
					{
						type: 'GRADIENT_LINEAR',
						visible: true,
						opacity: 1,
						blendMode: 'NORMAL',
						gradientTransform: [
							[1, 0, 0],
							[0, 1, 0]
						],
						gradientStops: [
							{ position: 0, color: red },
							{ position: 1, color: red, boundVariables: { color: alias('brand') } }
						]
					}
				]
			}),
			...planSetProps(store, 'n9', {
				boundVariables: {},
				defaultStyle: {
					...defaultTextStyle(),
					boundVariables: { fontSize: alias('size'), fontFamily: alias('size') }
				}
			})
		]);
		const stops = resolver.resolvedNode('n4');
		const gradient = 'fills' in stops ? stops.fills[0] : undefined;
		expect(gradient).toMatchObject({ gradientStops: [{ color: red }, { color: red }] });
		const styled = resolver.resolvedNode('n9');
		expect('defaultStyle' in styled && styled.defaultStyle.fontSize).toBe(12);
		// fontFamily bound to a FLOAT variable: wrong type, raw family stays.
		expect('defaultStyle' in styled && styled.defaultStyle.fontName.family).toBe('Inter');
	});

	it('a color variable with alpha multiplies the paint opacity', () => {
		const store = sampleStore();
		applyChanges(
			store,
			planEntitySet(store, 'variable', 'brand', {
				valuesByMode: { light: { r: 0, g: 1, b: 0, a: 0.5 }, dark: blue }
			})
		);
		const resolver = new VariableResolver(store);
		expect(fillColor(resolver, 'n3')).toEqual({ color: { r: 0, g: 1, b: 0 }, opacity: 0.5 });
	});
});

describe('fallback to the raw value and inspection', () => {
	it('a missing variable, a cycle that slipped in, or a value of another type resolves to raw', () => {
		const store = sampleStore();
		applyChanges(store, [
			...planSetProps(store, 'n4', { boundVariables: { width: alias('ghost') } }),
			...planSetProps(store, 'n3', { boundVariables: { width: alias('brand') } })
		]);
		const resolver = new VariableResolver(store);
		expect(widthOf(resolver, 'n4')).toBe(100);
		expect(widthOf(resolver, 'n3')).toBe(1);
		expect(resolver.inspectBinding('n4', 'width')).toEqual({
			variableId: 'ghost',
			status: 'missing-variable'
		});
		expect(resolver.inspectBinding('n3', 'width')).toEqual({
			variableId: 'brand',
			status: 'type-mismatch'
		});
		expect(resolver.inspectBinding('n6', 'width')).toEqual({ variableId: 'gap', status: 'ok' });
		expect(resolver.inspectBinding('n6', 'height')).toBeUndefined();
	});

	it('does not loop on an alias cycle read from a corrupt file', () => {
		const store = sampleStore();
		store.document.variables.a = variable('a', 'theme', 'FLOAT', { light: alias('b') });
		store.document.variables.b = variable('b', 'theme', 'FLOAT', { light: alias('a') });
		const resolver = new VariableResolver(store);
		expect(resolver.resolveVariable('a')).toBeUndefined();
	});
});

describe('cache and invalidation', () => {
	function warm(resolver: VariableResolver): void {
		for (const id of ['n3', 'n4', 'n6', 'n8', 'n10']) resolver.resolvedNode(id);
	}

	function apply(store: DocumentStore, resolver: VariableResolver, changes: Change[]): void {
		resolver.onChange(applyChanges(store, changes));
	}

	it('reads are cached', () => {
		const resolver = new VariableResolver(sampleStore());
		warm(resolver);
		const computed = resolver.computeCount;
		warm(resolver);
		expect(resolver.computeCount).toBe(computed);
	});

	it('changing a variable updates every consumer, including through alias chains', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		apply(
			store,
			resolver,
			planEntitySet(store, 'variable', 'gap', { valuesByMode: { light: 4, dark: 32 } })
		);
		expect(widthOf(resolver, 'n3')).toBe(4);
		expect(widthOf(resolver, 'n6')).toBe(32);
		expect(widthOf(resolver, 'n8')).toBe(32);
		const shadow = resolver.resolvedNode('n10');
		expect('effects' in shadow && shadow.effects[0]).toMatchObject({ radius: 4 });

		apply(
			store,
			resolver,
			planEntitySet(store, 'variable', 'brand', { valuesByMode: { light: blue, dark: red } })
		);
		expect(fillColor(resolver, 'n3')).toEqual({ color: { r: 0, g: 0, b: 1 }, opacity: 1 });
	});

	it('editing an unrelated variable recomputes no node', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		const computed = resolver.computeCount;
		apply(
			store,
			resolver,
			planEntitySet(store, 'variable', 'size', { name: 'renamed', valuesByMode: { s: 1, l: 2 } })
		);
		warm(resolver);
		expect(resolver.computeCount).toBe(computed);
	});

	it('adding a variable to a collection recomputes no node', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		const computed = resolver.computeCount;
		apply(store, resolver, [
			...planEntityAdd('variable', variable('extra', 'theme', 'FLOAT', { light: 1, dark: 2 })),
			...planEntitySet(store, 'collection', 'theme', {
				variableIds: ['gap', 'brand', 'accent', 'extra']
			})
		]);
		warm(resolver);
		expect(resolver.computeCount).toBe(computed);
	});

	it('a mode change on a frame recomputes its descendants only', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		const before = resolver.computeCount;
		apply(store, resolver, planSetProps(store, 'n2', { explicitVariableModes: { theme: 'dark' } }));
		expect(widthOf(resolver, 'n3')).toBe(16);
		expect(widthOf(resolver, 'n6')).toBe(16);
		// n3 (under the frame) recomputed; n6, n8, n10 and n4 untouched.
		expect(resolver.computeCount - before).toBe(1);
	});

	it('changing the default mode of a collection recomputes only nodes that read it', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		const before = resolver.computeCount;
		apply(store, resolver, planEntitySet(store, 'collection', 'theme', { defaultModeId: 'dark' }));
		expect(widthOf(resolver, 'n3')).toBe(16);
		warm(resolver);
		// n3, n6, n8, n10 read theme; n4 has no bindings and stays cached.
		expect(resolver.computeCount - before).toBe(4);
	});

	it('deleting a bound variable drops dependents back to the raw value', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		apply(store, resolver, [
			{ t: 'entity-del', kind: 'variable', entity: store.document.variables.gap }
		]);
		expect(widthOf(resolver, 'n3')).toBe(1);
	});

	it('creating a variable that a binding already named makes it resolve', () => {
		const store = sampleStore();
		applyChanges(store, planSetProps(store, 'n4', { boundVariables: { width: alias('late') } }));
		const resolver = new VariableResolver(store);
		expect(widthOf(resolver, 'n4')).toBe(100);
		apply(
			store,
			resolver,
			planEntityAdd('variable', variable('late', 'theme', 'FLOAT', { light: 77, dark: 78 }))
		);
		expect(widthOf(resolver, 'n4')).toBe(77);
	});

	it('moving a node into a dark frame re-resolves it', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		expect(widthOf(resolver, 'n3')).toBe(8);
		apply(store, resolver, [
			{ t: 'move', id: 'n3', parent: 'n5', index: 'a9', prevParent: 'n2', prevIndex: 'a0' }
		]);
		expect(widthOf(resolver, 'n3')).toBe(16);
	});

	it('does not leak dependency indexes when entries are dropped', () => {
		const store = sampleStore();
		const resolver = new VariableResolver(store);
		warm(resolver);
		apply(store, resolver, planSetProps(store, 'n3', { name: 'renamed' }));
		expect(resolver.cachedCount).toBe(4);
		warm(resolver);
		expect(resolver.cachedCount).toBe(5);
	});
});

describe('write-time validation', () => {
	function check(store: DocumentStore, changes: Change[]): void {
		validateVariableChanges(store, changes);
	}

	it('rejects a direct, an indirect and a self alias cycle, naming the path', () => {
		const store = sampleStore();
		// accent -> brand; making brand -> accent closes the loop.
		expect(() =>
			check(
				store,
				planEntitySet(store, 'variable', 'brand', {
					valuesByMode: { light: alias('accent'), dark: blue }
				})
			)
		).toThrow(AliasCycleError);
		expect(() =>
			check(
				store,
				planEntitySet(store, 'variable', 'brand', {
					valuesByMode: { light: alias('brand'), dark: blue }
				})
			)
		).toThrow(/brand -> brand/);
		// two new variables that alias each other in one transaction
		expect(() =>
			check(store, [
				...planEntityAdd(
					'variable',
					variable('x', 'theme', 'FLOAT', { light: alias('y'), dark: 1 })
				),
				...planEntityAdd(
					'variable',
					variable('y', 'theme', 'FLOAT', { light: 1, dark: alias('x') })
				)
			])
		).toThrow(AliasCycleError);
	});

	it('a cycle through another mode of the same variables is also rejected', () => {
		const store = sampleStore();
		expect(() =>
			check(
				store,
				planEntitySet(store, 'variable', 'gap', {
					valuesByMode: { light: 8, dark: alias('sizeAlias') }
				})
			)
		).toThrow(AliasCycleError);
	});

	it('rejects aliases to missing variables, to another type, and values of the wrong type', () => {
		const store = sampleStore();
		expect(() =>
			check(
				store,
				planEntitySet(store, 'variable', 'gap', {
					valuesByMode: { light: alias('ghost'), dark: 1 }
				})
			)
		).toThrow(InvalidAliasError);
		expect(() =>
			check(
				store,
				planEntitySet(store, 'variable', 'gap', {
					valuesByMode: { light: alias('brand'), dark: 1 }
				})
			)
		).toThrow(/cannot alias/);
		expect(() =>
			check(
				store,
				planEntitySet(store, 'variable', 'gap', { valuesByMode: { light: 'wide', dark: 1 } })
			)
		).toThrow(/not a FLOAT/);
	});

	it('accepts valid chains and ignores changes that are not about variables', () => {
		const store = sampleStore();
		expect(() =>
			check(store, [
				...planEntityAdd(
					'variable',
					variable('deep', 'theme', 'COLOR', { light: alias('accent'), dark: red })
				),
				...planSetProps(store, 'n3', { name: 'x' })
			])
		).not.toThrow();
	});
});

describe('budget', () => {
	it('resolves 10k nodes with bindings well inside the budget', () => {
		const specs = Array.from({ length: 10_000 }, (_, index) =>
			rectangle({
				name: `r${index}`,
				width: 1,
				boundVariables: { width: alias('gap') },
				fills: [
					{
						type: 'SOLID',
						visible: true,
						opacity: 1,
						blendMode: 'NORMAL',
						color: { r: 0, g: 0, b: 0 },
						boundVariables: { color: alias('accent') }
					}
				]
			})
		);
		const document = buildDocument([
			page('Big', [frame({ explicitVariableModes: { theme: 'dark' } }, specs)])
		]);
		const source = sampleStore().document;
		document.variableCollections = source.variableCollections;
		document.variables = source.variables;
		const store = new DocumentStore(document);
		const resolver = new VariableResolver(store);
		const ids = Object.keys(store.nodes);

		const started = performance.now();
		for (const id of ids) resolver.resolvedNode(id);
		const cold = performance.now() - started;
		const reread = performance.now();
		for (const id of ids) resolver.resolvedNode(id);
		const warmTime = performance.now() - reread;
		process.stdout.write(
			`variables: cold resolve of ${ids.length} bound nodes ${cold.toFixed(1)} ms, cached re-read ${warmTime.toFixed(1)} ms\n`
		);
		expect(cold).toBeLessThan(COLD_BUDGET_MS);
		expect(warmTime).toBeLessThan(WARM_BUDGET_MS);
		expect(widthOf(resolver, ids[5])).toBe(16);
	});
});

// Documented budget, asserted with ~10x headroom so CI noise does not flake.
const COLD_BUDGET_MS = 500;
const WARM_BUDGET_MS = 100;
