import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import historyPlugin from '../../plugins/history';
import selectionPlugin from '../../plugins/selection';
import coreKeymap from '../../plugins/core-keymap';
import variablesCore from '../../plugins/variables-core';
import type { Context, Plugin } from '@neoworks/extension-system';
import { AliasCycleError, type DesignDocument, type NodeId } from '../document';
import { buildDocument, frame, page, rectangle } from '../document/fixtures';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import { documentWith } from './fixtures/documentFixture';
import { VariableBindingError } from './variables';

// n1 page P: n2 frame LIGHT (n3 rect, n4 rect) ; n5 frame DARK-capable (n6 rect, n7 frame (n8 rect))
function layoutDocument(): DesignDocument {
	return buildDocument([
		page('P', [
			frame({ name: 'A' }, [rectangle({ name: 'R1' }), rectangle({ name: 'R2' })]),
			frame({ name: 'B' }, [
				rectangle({ name: 'R3' }),
				frame({ name: 'C' }, [rectangle({ name: 'R4' })])
			])
		])
	]);
}

const keymap: Plugin.Object = {
	...coreKeymap,
	apply: (ctx: Context) => coreKeymap.apply(ctx, { platform: 'linux' })
};
const baseProviders = (): Plugin[] => [
	coreContextKeys,
	coreCommands,
	keymap,
	documentWith(layoutDocument()),
	selectionPlugin,
	historyPlugin
];

describePlugin('variables-core', variablesCore, {
	providers: baseProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.variables.collections()).toEqual([]);
		expect(ctx.variables.resolve('n3', 'width')).toBe(100);
	}
});

async function mount(): Promise<MountedPlugin> {
	return mountPlugin(variablesCore, { providers: baseProviders() });
}

interface Theme {
	collectionId: string;
	light: string;
	dark: string;
	gap: string;
	brand: string;
}

function createTheme(mounted: MountedPlugin): Theme {
	const { variables } = mounted.ctx;
	const collectionId = variables.createCollection('Theme', ['Light']);
	const light = variables.collection(collectionId)?.defaultModeId ?? '';
	const dark = variables.addMode(collectionId, 'Dark');
	const gap = variables.createVariable(collectionId, 'gap', 'FLOAT', { [light]: 8, [dark]: 16 });
	const brand = variables.createVariable(collectionId, 'brand', 'COLOR', {
		[light]: { r: 1, g: 0, b: 0, a: 1 },
		[dark]: { r: 0, g: 0, b: 1, a: 1 }
	});
	return { collectionId, light, dark, gap, brand };
}

function bindWidths(mounted: MountedPlugin, theme: Theme, ids: NodeId[]): void {
	for (const id of ids) mounted.ctx.variables.bindVariable(id, 'width', theme.gap);
}

describe('binding and resolving', () => {
	it('a bound property reads the resolved value and changing the variable updates all consumers', async () => {
		const mounted = await mount();
		const { variables } = mounted.ctx;
		const theme = createTheme(mounted);
		bindWidths(mounted, theme, ['n3', 'n6', 'n8']);
		expect(variables.resolve('n3', 'width')).toBe(8);
		expect(variables.resolvedNode('n6')).toMatchObject({ width: 8, height: 100 });
		// the stored node keeps its raw value as the fallback
		expect(mounted.ctx.document.get('n3')).toMatchObject({ width: 100 });

		const seen: unknown[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(variables.resolve('n8', 'width'));
			});
		});
		await Promise.resolve();
		variables.setVariableValue(theme.gap, theme.light, 24);
		await Promise.resolve();
		stop();
		expect(seen).toEqual([8, 24]);
		expect(variables.resolve('n3', 'width')).toBe(24);
		expect(variables.resolve('n6', 'width')).toBe(24);
		await mounted.cleanup();
	});

	it('a mode change on a frame changes the resolved values of its descendants only', async () => {
		const mounted = await mount();
		const { variables, history } = mounted.ctx;
		const theme = createTheme(mounted);
		bindWidths(mounted, theme, ['n3', 'n6', 'n8']);

		variables.setExplicitMode('n5', theme.collectionId, theme.dark);
		expect(variables.resolve('n3', 'width')).toBe(8);
		expect(variables.resolve('n6', 'width')).toBe(16);
		expect(variables.resolve('n8', 'width')).toBe(16);
		expect(variables.modeFor(theme.collectionId, 'n8')).toBe(theme.dark);
		expect(variables.modeFor(theme.collectionId, 'n3')).toBe(theme.light);

		history.undo();
		expect(variables.resolve('n6', 'width')).toBe(8);
		history.redo();
		expect(variables.resolve('n6', 'width')).toBe(16);

		variables.setExplicitMode('n5', theme.collectionId, null);
		expect(variables.resolve('n8', 'width')).toBe(8);
		expect(mounted.ctx.document.get('n5')).not.toHaveProperty('explicitVariableModes');
		await mounted.cleanup();
	});

	it('aliases resolve across collections in the mode of the target collection', async () => {
		const mounted = await mount();
		const { variables } = mounted.ctx;
		const theme = createTheme(mounted);
		const sizes = variables.createCollection('Sizes', ['Default']);
		const mode = variables.collection(sizes)?.defaultModeId ?? '';
		const spacing = variables.createVariable(sizes, 'spacing', 'FLOAT', {
			[mode]: { type: 'VARIABLE_ALIAS', id: theme.gap }
		});
		variables.bindVariable('n6', 'width', spacing);
		variables.setExplicitMode('n5', theme.collectionId, theme.dark);
		expect(variables.resolve('n6', 'width')).toBe(16);
		await mounted.cleanup();
	});

	it('paint colors bind to color variables, follow modes, and detach keeping the current color', async () => {
		const mounted = await mount();
		const { variables, document } = mounted.ctx;
		const theme = createTheme(mounted);
		document.apply(
			document.setProps('n3', {
				fills: [
					{
						type: 'SOLID',
						visible: true,
						opacity: 1,
						blendMode: 'NORMAL',
						color: { r: 0.5, g: 0.5, b: 0.5 }
					}
				]
			}),
			{ origin: 'user', label: 'fill' }
		);
		variables.bindPaintColor('n3', 'fills', 0, theme.brand);
		expect(() => variables.bindPaintColor('n3', 'fills', 0, theme.gap)).toThrow(
			VariableBindingError
		);
		const fill = (id: string): unknown => {
			const node = variables.resolvedNode(id);
			return 'fills' in node ? node.fills[0] : undefined;
		};
		expect(fill('n3')).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
		variables.setExplicitMode('n2', theme.collectionId, theme.dark);
		expect(fill('n3')).toMatchObject({ color: { r: 0, g: 0, b: 1 } });
		variables.unbindPaintColor('n3', 'fills', 0);
		const stored = document.get('n3');
		expect(stored && 'fills' in stored && stored.fills[0]).toMatchObject({
			color: { r: 0, g: 0, b: 1 }
		});
		expect(stored && 'fills' in stored && stored.fills[0]).not.toHaveProperty('boundVariables');
		await mounted.cleanup();
	});

	it('unbind detaches with the value the property resolves to; bind and unbind are undoable', async () => {
		const mounted = await mount();
		const { variables, document, history } = mounted.ctx;
		const theme = createTheme(mounted);
		history.clear();
		variables.bindVariable('n3', 'width', theme.gap);
		variables.unbind('n3', 'width');
		expect(document.get('n3')).toMatchObject({ width: 8 });
		expect(document.get('n3')).not.toHaveProperty('boundVariables.width');
		expect(variables.inspectBinding('n3', 'width')).toBeUndefined();
		history.undo();
		expect(document.get('n3')).toMatchObject({
			width: 100,
			boundVariables: { width: { id: theme.gap } }
		});
		history.undo();
		expect(document.get('n3')).toMatchObject({ width: 100 });
		await mounted.cleanup();
	});

	it('refuses to bind a property to a variable of another type or a non-scalar property', async () => {
		const mounted = await mount();
		const { variables } = mounted.ctx;
		const theme = createTheme(mounted);
		expect(() => variables.bindVariable('n3', 'width', theme.brand)).toThrow(/cannot bind FLOAT/);
		expect(() => variables.bindVariable('n3', 'fills', theme.gap)).toThrow(/not a scalar/);
		expect(() => variables.bindVariable('n3', 'nothing', theme.gap)).toThrow(/no property/);
		expect(() => variables.bindVariable('n3', 'width', 'ghost')).toThrow(/not found/);
		await mounted.cleanup();
	});

	it('a deleted variable leaves the raw value and the binding is flagged', async () => {
		const mounted = await mount();
		const { variables } = mounted.ctx;
		const theme = createTheme(mounted);
		bindWidths(mounted, theme, ['n3']);
		variables.removeVariable(theme.gap);
		expect(variables.resolve('n3', 'width')).toBe(100);
		expect(variables.inspectBinding('n3', 'width')).toEqual({
			variableId: theme.gap,
			status: 'missing-variable'
		});
		expect(variables.collection(theme.collectionId)?.variableIds).toEqual([theme.brand]);
		await mounted.cleanup();
	});
});

describe('collections and modes', () => {
	it('removing a mode drops its values and moves the default; the last mode cannot go', async () => {
		const mounted = await mount();
		const { variables } = mounted.ctx;
		const theme = createTheme(mounted);
		variables.removeMode(theme.collectionId, theme.light);
		expect(variables.collection(theme.collectionId)?.defaultModeId).toBe(theme.dark);
		expect(variables.variable(theme.gap)?.valuesByMode).toEqual({ [theme.dark]: 16 });
		expect(() => variables.removeMode(theme.collectionId, theme.dark)).toThrow(/last mode/);
		await mounted.cleanup();
	});

	it('changing the default mode changes what unbound-mode nodes resolve to', async () => {
		const mounted = await mount();
		const { variables } = mounted.ctx;
		const theme = createTheme(mounted);
		bindWidths(mounted, theme, ['n3']);
		variables.setDefaultMode(theme.collectionId, theme.dark);
		expect(variables.resolve('n3', 'width')).toBe(16);
		variables.renameMode(theme.collectionId, theme.dark, 'Night');
		expect(variables.collection(theme.collectionId)?.modes.map((mode) => mode.name)).toEqual([
			'Light',
			'Night'
		]);
		await mounted.cleanup();
	});

	it('rapid edits of one value coalesce into one undo step', async () => {
		const mounted = await mount();
		const { variables, history } = mounted.ctx;
		const theme = createTheme(mounted);
		history.clear();
		for (const value of [9, 10, 11, 12]) variables.setVariableValue(theme.gap, theme.light, value);
		expect(history.entries).toHaveLength(1);
		history.undo();
		expect(variables.resolveVariable(theme.gap)).toBe(8);
		await mounted.cleanup();
	});
});

describe('alias cycles are rejected at write time', () => {
	it('through the service, through document.apply, and leave the state untouched', async () => {
		const mounted = await mount();
		const { variables, document } = mounted.ctx;
		const theme = createTheme(mounted);
		const accent = variables.createVariable(theme.collectionId, 'accent', 'COLOR', {
			[theme.light]: { type: 'VARIABLE_ALIAS', id: theme.brand },
			[theme.dark]: { type: 'VARIABLE_ALIAS', id: theme.brand }
		});
		const before = JSON.stringify(document.snapshot.variables);
		const revision = document.revision;

		expect(() =>
			variables.setVariableValue(theme.brand, theme.light, { type: 'VARIABLE_ALIAS', id: accent })
		).toThrow(AliasCycleError);
		expect(() =>
			document.apply(
				document.setEntityProps('variable', theme.brand, {
					valuesByMode: {
						[theme.light]: { type: 'VARIABLE_ALIAS', id: accent },
						[theme.dark]: { r: 0, g: 0, b: 1, a: 1 }
					}
				}),
				{ origin: 'plugin', label: 'sneaky' }
			)
		).toThrow(/alias cycle/);
		expect(JSON.stringify(document.snapshot.variables)).toBe(before);
		expect(document.revision).toBe(revision);
		expect(variables.resolveVariable(accent)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
		await mounted.cleanup();
	});

	it('also stops the AI and plugin origins, and a bad alias target', async () => {
		const mounted = await mount();
		const { variables, document } = mounted.ctx;
		const theme = createTheme(mounted);
		expect(() =>
			document.apply(
				document.setEntityProps('variable', theme.gap, {
					valuesByMode: {
						[theme.light]: { type: 'VARIABLE_ALIAS', id: theme.brand },
						[theme.dark]: 1
					}
				}),
				{ origin: 'ai', label: 'ai edit' }
			)
		).toThrow(/cannot alias/);
		expect(variables.resolveVariable(theme.gap)).toBe(8);
		await mounted.cleanup();
	});
});

describe('document replace', () => {
	it('drops the resolver of the old document', async () => {
		const mounted = await mount();
		const { variables, document } = mounted.ctx;
		const theme = createTheme(mounted);
		bindWidths(mounted, theme, ['n3']);
		expect(variables.resolve('n3', 'width')).toBe(8);
		document.replaceDocument(layoutDocument());
		expect(variables.collections()).toEqual([]);
		expect(variables.resolve('n3', 'width')).toBe(100);
		await mounted.cleanup();
	});
});
