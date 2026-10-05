import { afterEach, describe, expect, it } from 'vitest';
import { createNode, plainText, type NodeId } from '../../lib/document';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import componentSync from '../component-sync';
import components from '../components';
import designPanel from '../design-panel';
import variants from '../variants';
import componentProperties from './index';

describePlugin('component-properties', componentProperties, {
	providers: [...panelProviders(), componentSync],
	contributes: ({ ctx }) => {
		const ids = ctx.inspectors.registry.listAll().map((entry) => entry.id);
		expect(ids).toContain('component-properties');
		expect(ids).toContain('layer-bindings');
		expect(ids).toContain('instance-properties');
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(componentProperties, [
		componentSync,
		components,
		variants,
		fakeOverlay,
		designPanel
	]);
	return harness;
}

async function run(panel: PanelHarness, command: string): Promise<void> {
	await panel.ctx.commands.run(command);
	panel.select([...panel.ctx.selection.ids]);
}

/** Frame `f` (a, b, c and a text layer `title`) as a main component; returns the ids. */
async function mainWithText(panel: PanelHarness): Promise<{ mainId: NodeId; titleId: NodeId }> {
	const title = createNode('TEXT', {
		id: 'title',
		name: 'title',
		parentId: 'f',
		index: 'zz0',
		paragraphs: [
			{
				runs: [{ text: 'Hello', style: {} }],
				align: 'LEFT',
				indent: 0,
				spacingAfter: 0,
				list: 'NONE',
				listLevel: 0
			}
		]
	});
	panel.ctx.document.apply(panel.ctx.document.insertNode(title), {
		origin: 'user',
		label: 'Add title'
	});
	panel.select(['f']);
	await run(panel, 'components.create');
	const [mainId] = panel.ctx.selection.ids;
	return { mainId, titleId: 'title' };
}

function confirmDialog(panel: PanelHarness): void {
	const buttons = [
		...document.body.querySelectorAll<HTMLButtonElement>('[data-create-property] button')
	];
	const create = buttons.find((button) => button.textContent?.trim() === 'Create property');
	if (create === undefined) throw new Error('no create button');
	create.click();
	panel.select([...panel.ctx.selection.ids]);
}

function pressButton(panel: PanelHarness, label: string): void {
	panel.click(`button[aria-label="${label}"]`);
}

function definitions(panel: PanelHarness, mainId: NodeId): string[] {
	const main = panel.ctx.document.require(mainId);
	if (main.type !== 'COMPONENT') throw new Error('not a component');
	return Object.keys(main.componentPropertyDefinitions);
}

describe('creating properties', () => {
	it('creates a boolean property from the main component dialog and adds it to instances', async () => {
		const panel = await open();
		const { mainId } = await mainWithText(panel);
		await run(panel, 'components.create-instance');
		const [instanceId] = panel.ctx.selection.ids;
		panel.select([mainId]);
		expect(panel.sectionIds()).toContain('design/component-properties');
		pressButton(panel, 'Create property');
		const name = panel.field('Property name');
		name.value = 'Selected';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		confirmDialog(panel);
		expect(definitions(panel, mainId)).toEqual(['Selected']);
		const instance = panel.ctx.document.require(instanceId);
		expect(instance.type === 'INSTANCE' && instance.componentProperties.Selected).toEqual({
			type: 'BOOLEAN',
			value: true
		});
		panel.undo();
		expect(definitions(panel, mainId)).toEqual([]);
	});

	it('creates a property from a layer, binds it and takes the layer value', async () => {
		const panel = await open();
		const { mainId } = await mainWithText(panel);
		panel.select(['a']);
		const layerId = panel.ctx.document.children(mainId)[0];
		panel.select([layerId]);
		expect(panel.sectionIds()).toContain('design/layer-bindings');
		pressButton(panel, 'Create property for Visibility');
		expect(panel.field('Property name').value).toBe('a');
		confirmDialog(panel);
		expect(definitions(panel, mainId)).toEqual(['a']);
		expect(panel.ctx.document.require(layerId).componentPropertyReferences).toEqual({
			visible: 'a'
		});
	});
});

describe('instance controls', () => {
	async function instanceWithProperties(panel: PanelHarness): Promise<{
		mainId: NodeId;
		instanceId: NodeId;
		visibleLayer: NodeId;
		titleCopy: NodeId;
	}> {
		const { mainId } = await mainWithText(panel);
		const [visibleLayer, , , titleLayer] = panel.ctx.document.children(mainId);
		panel.select([visibleLayer]);
		pressButton(panel, 'Create property for Visibility');
		panel.field('Property name').value = 'Show a';
		panel.field('Property name').dispatchEvent(new Event('input', { bubbles: true }));
		confirmDialog(panel);
		panel.select([titleLayer]);
		pressButton(panel, 'Create property for Text');
		panel.field('Property name').value = 'Title';
		panel.field('Property name').dispatchEvent(new Event('input', { bubbles: true }));
		confirmDialog(panel);
		panel.select([mainId]);
		await run(panel, 'components.create-instance');
		const [instanceId] = panel.ctx.selection.ids;
		const copies = panel.ctx.document.childNodes(instanceId);
		return {
			mainId,
			instanceId,
			visibleLayer: copies[0].id,
			titleCopy: copies[3].id
		};
	}

	it('toggling a boolean updates the bound layer, marks the override, and undoes', async () => {
		const panel = await open();
		const { instanceId, visibleLayer } = await instanceWithProperties(panel);
		panel.select([instanceId]);
		expect(panel.sectionIds()).toContain('design/instance-properties');
		panel.click('input[aria-label="Show a"]');
		expect(Reflect.get(panel.ctx.document.require(visibleLayer), 'visible')).toBe(false);
		expect(panel.ctx.document.require(visibleLayer).touched).toContain('visibility');
		const instance = panel.ctx.document.require(instanceId);
		expect(instance.type === 'INSTANCE' && instance.componentProperties['Show a'].value).toBe(
			false
		);
		panel.undo();
		expect(Reflect.get(panel.ctx.document.require(visibleLayer), 'visible')).toBe(true);
		expect(panel.ctx.document.require(visibleLayer).touched).toEqual([]);
	});

	it('editing a text property rewrites the bound text layer', async () => {
		const panel = await open();
		const { instanceId, titleCopy } = await instanceWithProperties(panel);
		panel.select([instanceId]);
		const field = panel.field('Title');
		expect(field.value).toBe('Hello');
		field.value = 'Welcome';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		const layer = panel.ctx.document.require(titleCopy);
		if (layer.type !== 'TEXT') throw new Error('not text');
		expect(plainText(layer.paragraphs)).toBe('Welcome');
		panel.undo();
		const undone = panel.ctx.document.require(titleCopy);
		expect(undone.type === 'TEXT' && plainText(undone.paragraphs)).toBe('Hello');
	});

	it('renaming a property rebinds the layers and the instance values; deleting removes them', async () => {
		const panel = await open();
		const { mainId, instanceId, visibleLayer } = await instanceWithProperties(panel);
		panel.select([mainId]);
		const rename = panel.field('Property Show a');
		rename.value = 'Visible';
		rename.dispatchEvent(new Event('change', { bubbles: true }));
		panel.select([mainId]);
		expect(definitions(panel, mainId)).toEqual(['Visible', 'Title']);
		const layer = panel.ctx.document.children(mainId)[0];
		expect(panel.ctx.document.require(layer).componentPropertyReferences).toEqual({
			visible: 'Visible'
		});
		const instance = panel.ctx.document.require(instanceId);
		expect(instance.type === 'INSTANCE' && Object.keys(instance.componentProperties)).toEqual([
			'Visible',
			'Title'
		]);

		pressButton(panel, 'Delete property Visible');
		expect(definitions(panel, mainId)).toEqual(['Title']);
		expect(panel.ctx.document.require(layer).componentPropertyReferences).toBeUndefined();
		const after = panel.ctx.document.require(instanceId);
		expect(after.type === 'INSTANCE' && Object.keys(after.componentProperties)).toEqual(['Title']);
		expect(Reflect.get(panel.ctx.document.require(visibleLayer), 'visible')).toBe(true);
		panel.undo();
		expect(definitions(panel, mainId)).toEqual(['Visible', 'Title']);
	});

	it('changing the default of a property updates the bound layer of the main', async () => {
		const panel = await open();
		const { mainId } = await instanceWithProperties(panel);
		panel.select([mainId]);
		panel.click('input[aria-label="Default of Show a"]');
		const layer = panel.ctx.document.children(mainId)[0];
		expect(Reflect.get(panel.ctx.document.require(layer), 'visible')).toBe(false);
		const main = panel.ctx.document.require(mainId);
		expect(
			main.type === 'COMPONENT' && main.componentPropertyDefinitions['Show a'].defaultValue
		).toBe(false);
		panel.undo();
		expect(Reflect.get(panel.ctx.document.require(layer), 'visible')).toBe(true);
	});
});
