import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import componentSync from '../component-sync';
import components from '../components';
import designPanel from '../design-panel';
import variants from './index';

describePlugin('variants', variants, {
	providers: [...panelProviders(), componentSync, components, fakeOverlay],
	contributes: ({ ctx }) => {
		const bound = ctx.keymap.registry
			.listAll()
			.map((binding) => `${binding.chord}>${binding.command}`);
		expect(bound).toContain('ctrl+alt+shift+k>variants.combine');
		expect(ctx.commands.has('variants.add')).toBe(true);
		expect(ctx.regions.registry.list().map((entry) => entry.id)).toContain('variants/chips');
		const menuItems = ctx.menus.registry.listAll().map((entry) => entry.id);
		expect(menuItems).toContain('context/canvas|variants.combine');
		expect(menuItems).toContain('context/layer|variants.add');
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(variants, [
		componentSync,
		components,
		fakeOverlay,
		designPanel
	]);
	return harness;
}

async function run(panel: PanelHarness, command: string): Promise<void> {
	await panel.ctx.commands.run(command);
	panel.select([...panel.ctx.selection.ids]);
}

/** Frame `f` as a component, then its set; returns the set id. */
async function setFromFrame(panel: PanelHarness): Promise<string> {
	panel.select(['f']);
	await run(panel, 'variants.combine');
	const [setId] = panel.ctx.selection.ids;
	return setId;
}

describe('combine as variants', () => {
	it('turns a frame into a component inside a new set in one undo step', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		const set = panel.ctx.document.require(setId);
		expect(set.type).toBe('COMPONENT_SET');
		const [variantId] = panel.ctx.document.children(setId);
		const variant = panel.ctx.document.require(variantId);
		expect(variant.type).toBe('COMPONENT');
		if (variant.type !== 'COMPONENT' || set.type !== 'COMPONENT_SET') return;
		expect(variant.variantProperties).toEqual({ 'Property 1': 'F' });
		expect(variant.name).toBe('Property 1=F');
		expect(set.componentPropertyDefinitions['Property 1']).toMatchObject({ type: 'VARIANT' });
		expect(panel.ctx.document.children(variantId)).toEqual(['a', 'b', 'c']);
		expect(panel.sectionIds()).toContain('design/variant-set');

		panel.undo();
		expect(panel.ctx.document.has(setId)).toBe(false);
		expect(panel.ctx.document.require('f').type).toBe('FRAME');
		expect(panel.ctx.document.children('f')).toEqual(['a', 'b', 'c']);
	});

	it('combines two components and keeps their positions relative to each other', async () => {
		const panel = await open();
		panel.select(['f']);
		await run(panel, 'components.create');
		const [first] = panel.ctx.selection.ids;
		panel.select(['loose']);
		await run(panel, 'components.create');
		const [second] = panel.ctx.selection.ids;
		const before = (id: string): number => {
			const node = panel.ctx.document.require(id);
			return 'transform' in node ? node.transform[0][2] : 0;
		};
		const gap = before(second) - before(first);
		panel.select([first, second]);
		await run(panel, 'variants.combine');
		const [setId] = panel.ctx.selection.ids;
		expect(panel.ctx.document.children(setId)).toEqual([first, second]);
		expect(before(second) - before(first)).toBe(gap);
		const names = panel.ctx.document.childNodes(setId).map((node) => node.name);
		expect(names).toHaveLength(2);
		expect(new Set(names).size).toBe(2);
	});
});

describe('add and remove variants', () => {
	it('adds a variant below the others, selects it and undoes in one step', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		await run(panel, 'variants.add');
		const children = panel.ctx.document.children(setId);
		expect(children).toHaveLength(2);
		expect([...panel.ctx.selection.ids]).toEqual([children[1]]);
		const added = panel.ctx.document.require(children[1]);
		expect(added.type === 'COMPONENT' && added.variantProperties).toEqual({
			'Property 1': 'Variant2'
		});
		expect(panel.ctx.document.children(children[1])).toHaveLength(3);
		panel.undo();
		expect(panel.ctx.document.children(setId)).toHaveLength(1);
	});

	it('removing a variant is one undoable step', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		await run(panel, 'variants.add');
		const [, second] = panel.ctx.document.children(setId);
		panel.ctx.document.apply(panel.ctx.document.removeNode(second), {
			origin: 'user',
			label: 'Delete variant'
		});
		expect(panel.ctx.document.children(setId)).toHaveLength(1);
		panel.undo();
		expect(panel.ctx.document.children(setId)).toHaveLength(2);
	});
});

describe('variant properties', () => {
	it('adds, renames and deletes a property across all variants', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		await run(panel, 'variants.add');
		panel.select([setId]);
		const sectionButton = (text: string): HTMLButtonElement => {
			const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button')];
			const found = buttons.find((button) => button.textContent?.trim() === text);
			if (found === undefined) throw new Error(`no button ${text}`);
			return found;
		};
		sectionButton('Add property').click();
		panel.select([setId]);
		const set = (): { definitions: string[]; values: unknown[] } => {
			const node = panel.ctx.document.require(setId);
			if (node.type !== 'COMPONENT_SET') throw new Error('not a set');
			return {
				definitions: Object.keys(node.componentPropertyDefinitions),
				values: panel.ctx.document
					.childNodes(setId)
					.map((variant) => (variant.type === 'COMPONENT' ? variant.variantProperties : undefined))
			};
		};
		expect(set().definitions).toEqual(['Property 1', 'Property 2']);
		expect(set().values).toEqual([
			{ 'Property 1': 'F', 'Property 2': 'Default' },
			{ 'Property 1': 'Variant2', 'Property 2': 'Default' }
		]);

		const field = panel.field('Property name Property 2');
		field.value = 'Size';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		panel.select([setId]);
		expect(set().definitions).toEqual(['Property 1', 'Size']);
		expect(set().values[0]).toEqual({ 'Property 1': 'F', Size: 'Default' });

		panel.click('button[aria-label="Delete property Size"]');
		expect(set().definitions).toEqual(['Property 1']);
		expect(set().values[0]).toEqual({ 'Property 1': 'F' });
		panel.undo();
		expect(set().definitions).toEqual(['Property 1', 'Size']);
	});

	it('edits the value of a variant property from the variant section', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		const [variantId] = panel.ctx.document.children(setId);
		panel.select([variantId]);
		expect(panel.sectionIds()).toContain('design/variant');
		const field = panel.field('Variant value Property 1');
		field.value = 'Primary';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		const variant = panel.ctx.document.require(variantId);
		expect(variant.type === 'COMPONENT' && variant.variantProperties).toEqual({
			'Property 1': 'Primary'
		});
		expect(variant.name).toBe('Property 1=Primary');
	});
});

describe('switching the variant of an instance', () => {
	it('swaps the main, keeps the id and the overrides by name path, and undoes in one step', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		await run(panel, 'variants.add');
		const [first, second] = panel.ctx.document.children(setId);
		panel.select([first]);
		await run(panel, 'components.create-instance');
		const [instanceId] = panel.ctx.selection.ids;
		const instance = panel.ctx.document.require(instanceId);
		if (instance.type !== 'INSTANCE') throw new Error('not an instance');
		expect(instance.componentProperties['Property 1']).toEqual({ type: 'VARIANT', value: 'F' });
		expect(instance.name).toBe(panel.ctx.document.require(setId).name);

		const copyOfB = panel.ctx.document.childNodes(instanceId).find((child) => child.name === 'b');
		if (copyOfB === undefined) throw new Error('no copy of b');
		panel.setProps(copyOfB.id, { width: 3 });

		panel.ctx.document.apply(
			panel.ctx.document.setProps(instanceId, {
				componentProperties: { 'Property 1': { type: 'VARIANT', value: 'Variant2' } }
			}),
			{ origin: 'user', label: 'Switch variant' }
		);
		const switched = panel.ctx.document.require(instanceId);
		expect(switched.type === 'INSTANCE' && switched.mainComponentId).toBe(second);
		const newB = panel.ctx.document.childNodes(instanceId).find((child) => child.name === 'b');
		expect(newB?.id).not.toBe(copyOfB.id);
		expect(Reflect.get(newB ?? {}, 'width')).toBe(3);
		expect(newB?.touched).toEqual(['geometry']);

		panel.undo();
		const restored = panel.ctx.document.require(instanceId);
		expect(restored.type === 'INSTANCE' && restored.mainComponentId).toBe(first);
		expect(panel.ctx.document.has(copyOfB.id)).toBe(true);
	});

	it('shows a dropdown per variant property on the instance', async () => {
		const panel = await open();
		const setId = await setFromFrame(panel);
		const [variantId] = panel.ctx.document.children(setId);
		panel.select([variantId]);
		await run(panel, 'components.create-instance');
		expect(panel.sectionIds()).toContain('design/instance-variants');
		expect(panel.query('[data-instance-variant="Property 1"]')).not.toBeNull();
	});
});
