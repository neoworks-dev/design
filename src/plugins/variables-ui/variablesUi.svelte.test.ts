import type { Context } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import designPanel from '../design-panel';
import inspectorLayoutSize from '../inspector-layout-size';
import variablesUi from './index';

describePlugin('variables-ui', variablesUi, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('variables.open')).toBe(true);
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'variables-ui/dialog'
		);
		expect(ctx.panels.sectionRegistry.get('design/variable-mode')).toBeDefined();
	}
});

let mounted: MountedPlugin | undefined;
let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;
let harness: PanelHarness | undefined;

afterEach(async () => {
	if (host !== undefined) await unmount(host);
	target?.remove();
	await mounted?.cleanup();
	await harness?.dispose();
	host = undefined;
	target = undefined;
	mounted = undefined;
	harness = undefined;
});

async function openDialog(): Promise<Context> {
	mounted = await mountPlugin(variablesUi, { providers: panelProviders() });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'overlay' } });
	await mounted.ctx.commands.run('variables.open');
	flushSync();
	return mounted.ctx;
}

function click(selector: string): void {
	const element = document.body.querySelector<HTMLElement>(selector);
	if (element === null) throw new Error(`nothing matches ${selector}`);
	element.click();
	flushSync();
}

function clickButton(text: string): void {
	const buttons = [
		...document.body.querySelectorAll<HTMLElement>('[data-variables-dialog] button')
	];
	const found = buttons.find((button) => button.textContent.trim() === text);
	if (found === undefined) throw new Error(`no button ${text}`);
	found.click();
	flushSync();
}

describe('the variables modal', () => {
	it('creates a collection, adds a mode and variables of every type', async () => {
		const ctx = await openDialog();
		click('[data-add-collection]');
		expect(ctx.variables.collections().map((entry) => entry.name)).toEqual(['Collection']);
		click('[data-add-mode]');
		const [collection] = ctx.variables.collections();
		expect(collection.modes).toHaveLength(2);
		for (const label of ['Color', 'Number', 'String', 'Boolean']) clickButton(label);
		const types = ctx.variables.variables(collection.id).map((entry) => entry.resolvedType);
		expect(types).toEqual(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']);
		expect(document.body.querySelectorAll('[data-variable-row]')).toHaveLength(4);
	});

	it('groups variables by slash path and edits a value in one undo step', async () => {
		const ctx = await openDialog();
		const collectionId = ctx.variables.createCollection('Sizes');
		ctx.variables.createVariable(collectionId, 'Spacing/small', 'FLOAT');
		ctx.variablesUi.select(collectionId);
		flushSync();
		expect(document.body.querySelector('[data-variable-group="Spacing"]')).not.toBeNull();
		const input = document.body.querySelector<HTMLInputElement>(
			'input[aria-label="Spacing/small value"]'
		);
		if (input === null) throw new Error('no value input');
		input.value = '12';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		const [variable] = ctx.variables.variables(collectionId);
		const [modeId] = Object.keys(variable.valuesByMode);
		expect(variable.valuesByMode[modeId]).toBe(12);
		expect(ctx.history.undo()).toBe(true);
		expect(ctx.variables.variables(collectionId)[0].valuesByMode[modeId]).toBe(0);
	});

	it('duplicates and deletes a variable, and deletes a collection', async () => {
		const ctx = await openDialog();
		const collectionId = ctx.variables.createCollection('Sizes');
		const variableId = ctx.variables.createVariable(collectionId, 'gap', 'FLOAT');
		ctx.variablesUi.select(collectionId);
		flushSync();
		click('button[aria-label="Duplicate gap"]');
		expect(ctx.variables.variables(collectionId).map((entry) => entry.name)).toEqual([
			'gap',
			'gap copy'
		]);
		click('button[aria-label="Delete gap"]');
		expect(ctx.variables.variable(variableId)).toBeUndefined();
		clickButton('Delete collection');
		expect(ctx.variables.collection(collectionId)).toBeUndefined();
	});

	it('refuses an alias cycle with an error and leaves the values alone', async () => {
		const ctx = await openDialog();
		const collectionId = ctx.variables.createCollection('Sizes');
		const first = ctx.variables.createVariable(collectionId, 'a', 'FLOAT');
		const second = ctx.variables.createVariable(collectionId, 'b', 'FLOAT');
		ctx.variablesUi.select(collectionId);
		flushSync();
		const modeId = ctx.variables.collection(collectionId)?.defaultModeId;
		if (modeId === undefined) throw new Error('no mode');

		click(`[data-value-cell="${first}:${modeId}"] [data-alias-button]`);
		click(`[data-alias-option="${second}"]`);
		expect(document.body.querySelector('[data-variables-error]')).toBeNull();
		expect(
			document.body.querySelector(`[data-value-cell="${first}:${modeId}"] [data-alias-chip]`)
		).not.toBeNull();

		click(`[data-value-cell="${second}:${modeId}"] [data-alias-button]`);
		click(`[data-alias-option="${first}"]`);
		expect(document.body.querySelector('[data-variables-error]')).not.toBeNull();
		expect(ctx.variables.variable(second)?.valuesByMode[modeId]).toBe(0);
	});
});

describe('binding a field to a variable', () => {
	it('binds the width through the popover, resizes the node and unbinds', async () => {
		harness = await PanelHarness.create(variablesUi, [designPanel, inspectorLayoutSize]);
		const { ctx } = harness;
		const collectionId = ctx.variables.createCollection('Sizes');
		const wide = ctx.variables.createVariable(collectionId, 'wide', 'FLOAT');
		const modeId = ctx.variables.collection(collectionId)?.defaultModeId;
		if (modeId === undefined) throw new Error('no mode');
		ctx.variables.setVariableValue(wide, modeId, 64);
		ctx.variables.setVariableScopes(wide, ['WIDTH_HEIGHT']);
		const other = ctx.variables.createVariable(collectionId, 'opaque', 'FLOAT');
		ctx.variables.setVariableScopes(other, ['OPACITY']);
		harness.select(['a']);

		harness.click('[data-bind-variable="width"]');
		const options = [...document.body.querySelectorAll('[data-bind-option]')];
		expect(options.map((option) => option.getAttribute('data-bind-option'))).toEqual([wide]);
		harness.click(`[data-bind-option="${wide}"]`);
		expect(ctx.document.require('a')).toMatchObject({ boundVariables: { width: { id: wide } } });
		expect(ctx.variables.resolvedNode('a')).toMatchObject({ width: 64 });
		expect(ctx.history.entries.at(-1)?.label).toBe('Bind variable');

		harness.click('[data-bind-variable="width"]');
		harness.click('[data-unbind-variable]');
		expect(ctx.document.require('a').boundVariables).toEqual({});
		expect(ctx.document.require('a')).toMatchObject({ width: 64 });
	});

	it('shows the mode section only while a collection has several modes', async () => {
		harness = await PanelHarness.create(variablesUi, [designPanel]);
		const { ctx } = harness;
		harness.select(['f']);
		expect(harness.sectionIds()).not.toContain('design/variable-mode');
		const collectionId = ctx.variables.createCollection('Theme', ['Light', 'Dark']);
		flushSync();
		expect(harness.sectionIds()).toContain('design/variable-mode');
		harness.select(['a']);
		expect(harness.sectionIds()).not.toContain('design/variable-mode');
		expect(collectionId).toBeTruthy();
	});
});
