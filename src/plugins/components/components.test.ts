import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness, panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin } from '../../lib/kernel/testing';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import componentSync from '../component-sync';
import designPanel from '../design-panel';
import components from './index';

const BINDINGS: Record<string, string> = {
	'ctrl+alt+k': 'components.create',
	'ctrl+alt+b': 'components.detach',
	'shift+i': 'components.create-instance'
};

describePlugin('components', components, {
	providers: [...panelProviders(), componentSync, fakeOverlay],
	contributes: ({ ctx }) => {
		const bound = ctx.keymap.registry
			.listAll()
			.map((binding) => `${binding.chord}>${binding.command}`);
		for (const [chord, command] of Object.entries(BINDINGS)) {
			expect(bound, command).toContain(`${chord}>${command}`);
			expect(ctx.commands.has(command)).toBe(true);
		}
		expect(ctx.overlay.registry.list().map((entry) => entry.id)).toContain('components/labels');
		const menuItems = ctx.menus.registry.listAll().map((entry) => entry.id);
		expect(menuItems).toContain('context/canvas|components.create');
		expect(menuItems).toContain('context/layer|components.create');
		expect(menuItems).toContain('context/canvas|components.detach');
		expect(menuItems).toContain('context/layer|components.detach');
		expect(menuItems).toContain('context/canvas|components.go-to-main');
		for (const command of ['reset-overrides', 'push-overrides', 'restore-main']) {
			expect(menuItems).toContain(`context/layer|components.${command}`);
		}
		expect(menuItems).toContain('context/layer|components.go-to-main');
	}
});

let harness: PanelHarness | undefined;

afterEach(async () => {
	await harness?.dispose();
	harness = undefined;
});

async function open(): Promise<PanelHarness> {
	harness = await PanelHarness.create(components, [componentSync, fakeOverlay, designPanel]);
	return harness;
}

async function run(panel: PanelHarness, command: string): Promise<void> {
	await panel.ctx.commands.run(command);
	panel.select([...panel.ctx.selection.ids]);
}

describe('create component', () => {
	it('wraps loose layers in a component and undoes in one step', async () => {
		const panel = await open();
		panel.select(['a', 'b']);
		await run(panel, 'components.create');
		const [componentId] = panel.ctx.selection.ids;
		const component = panel.ctx.document.require(componentId);
		expect(component.type).toBe('COMPONENT');
		expect(panel.ctx.document.children(componentId)).toEqual(['a', 'b']);
		expect(panel.ctx.document.require('a').parentId).toBe(componentId);

		panel.undo();
		expect(panel.ctx.document.has(componentId)).toBe(false);
		expect(panel.ctx.document.require('a').parentId).toBe('f');
	});

	it('turns a frame into a component with the same name and children', async () => {
		const panel = await open();
		panel.select(['f']);
		await run(panel, 'components.create');
		const [componentId] = panel.ctx.selection.ids;
		const component = panel.ctx.document.require(componentId);
		expect(component.type).toBe('COMPONENT');
		expect(component.name).toBe('F');
		expect(panel.ctx.document.children(componentId)).toEqual(['a', 'b', 'c']);
		expect(panel.ctx.document.has('f')).toBe(false);
		expect(panel.sectionIds()).toContain('design/component');
	});

	it('does nothing inside an instance', async () => {
		const panel = await open();
		panel.select(['f']);
		await run(panel, 'components.create');
		await run(panel, 'components.create-instance');
		const [instanceId] = panel.ctx.selection.ids;
		const [copyId] = panel.ctx.document.children(instanceId);
		panel.select([copyId]);
		expect(panel.ctx.contextKeys.get('canCreateComponent')).toBe(false);
	});
});

describe('instances', () => {
	async function withInstance(
		panel: PanelHarness
	): Promise<{ mainId: string; instanceId: string }> {
		panel.select(['f']);
		await run(panel, 'components.create');
		const [mainId] = panel.ctx.selection.ids;
		await run(panel, 'components.create-instance');
		const [instanceId] = panel.ctx.selection.ids;
		return { mainId, instanceId };
	}

	it('creates an instance beside the main, linked to it, and selects it', async () => {
		const panel = await open();
		const { mainId, instanceId } = await withInstance(panel);
		const instance = panel.ctx.document.require(instanceId);
		expect(instance.type).toBe('INSTANCE');
		if (instance.type !== 'INSTANCE') return;
		expect(instance.mainComponentId).toBe(mainId);
		const copies = panel.ctx.document.childNodes(instanceId);
		expect(copies.map((copy) => copy.componentRef)).toEqual(['a', 'b', 'c']);
		expect(panel.sectionIds()).toContain('design/instance');
		panel.undo();
		expect(panel.ctx.document.has(instanceId)).toBe(false);
	});

	it('detaches into a frame, undoable, and selects the frame', async () => {
		const panel = await open();
		const { instanceId } = await withInstance(panel);
		await run(panel, 'components.detach');
		expect(panel.ctx.document.has(instanceId)).toBe(false);
		const [frameId] = panel.ctx.selection.ids;
		const frame = panel.ctx.document.require(frameId);
		expect(frame.type).toBe('FRAME');
		expect(
			panel.ctx.document.childNodes(frameId).every((child) => child.componentRef === undefined)
		).toBe(true);
		panel.undo();
		expect(panel.ctx.document.require(instanceId).type).toBe('INSTANCE');
	});

	it('goes to the main component', async () => {
		const panel = await open();
		const { mainId, instanceId } = await withInstance(panel);
		panel.select([instanceId]);
		await run(panel, 'components.go-to-main');
		expect([...panel.ctx.selection.ids]).toEqual([mainId]);
	});

	it('shows the configuration popover and saves the description as one undo step', async () => {
		const panel = await open();
		const { mainId } = await withInstance(panel);
		panel.select([mainId]);
		panel.click('button[aria-label="Edit component"]');
		const field = panel.query<HTMLTextAreaElement>('textarea[aria-label="Component description"]');
		if (field === null) throw new Error('no description field');
		field.value = 'Primary button';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		const main = panel.ctx.document.require(mainId);
		expect(main.type === 'COMPONENT' && main.description).toBe('Primary button');
		panel.undo();
		const undone = panel.ctx.document.require(mainId);
		expect(undone.type === 'COMPONENT' && undone.description).toBe('');
	});
});
