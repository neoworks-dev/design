import { afterEach, describe, expect, it } from 'vitest';
import { PanelHarness } from '../../lib/editing/fixtures/panelHarness';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import componentSync from '../component-sync';
import designPanel from '../design-panel';
import components from './index';

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

async function instanceWithOverride(
	panel: PanelHarness
): Promise<{ mainId: string; instanceId: string; copyId: string }> {
	panel.select(['f']);
	await run(panel, 'components.create');
	const [mainId] = panel.ctx.selection.ids;
	await run(panel, 'components.create-instance');
	const [instanceId] = panel.ctx.selection.ids;
	const [copyId] = panel.ctx.document.children(instanceId);
	panel.setProps(copyId, { width: 5 });
	return { mainId, instanceId, copyId };
}

function widthOf(panel: PanelHarness, id: string): unknown {
	return Reflect.get(panel.ctx.document.require(id), 'width');
}

function buttonByText(text: string): HTMLButtonElement {
	const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button')];
	const found = buttons.find((button) => button.textContent?.trim() === text);
	if (found === undefined) throw new Error(`no button "${text}"`);
	return found;
}

function press(panel: PanelHarness, text: string): void {
	buttonByText(text).click();
	panel.select([...panel.ctx.selection.ids]);
}

describe('overrides', () => {
	it('shows the overridden groups of the selected layer and resets one group', async () => {
		const panel = await open();
		const { copyId } = await instanceWithOverride(panel);
		panel.select([copyId]);
		expect(panel.ctx.contextKeys.get('selectionHasOverrides')).toBe(true);
		expect(panel.query('[data-override-group="geometry"]')).not.toBeNull();
		panel.click('button[aria-label="Reset Size and position"]');
		expect(widthOf(panel, copyId)).toBe(10);
		expect(panel.ctx.document.require(copyId).touched).toEqual([]);
		expect(panel.ctx.contextKeys.get('selectionHasOverrides')).toBe(false);
		panel.undo();
		expect(widthOf(panel, copyId)).toBe(5);
	});

	it('resets all overrides of the instance in one undo step', async () => {
		const panel = await open();
		const { instanceId, copyId } = await instanceWithOverride(panel);
		panel.setProps(copyId, { opacity: 0.5 });
		panel.select([instanceId]);
		expect(panel.query('[data-override-count]')?.textContent?.trim()).toBe('1 layer');
		press(panel, 'Reset all overrides');
		expect(widthOf(panel, copyId)).toBe(10);
		expect(Reflect.get(panel.ctx.document.require(copyId), 'opacity')).toBe(1);
		panel.undo();
		expect(widthOf(panel, copyId)).toBe(5);
		expect(Reflect.get(panel.ctx.document.require(copyId), 'opacity')).toBe(0.5);
	});

	it('pushes overrides to the main component and the other instances follow', async () => {
		const panel = await open();
		const { mainId, instanceId, copyId } = await instanceWithOverride(panel);
		await run(panel, 'components.create-instance');
		const [otherId] = panel.ctx.selection.ids;
		const mainChild = panel.ctx.document.children(mainId)[0];
		const [otherCopy] = panel.ctx.document.children(otherId);
		panel.select([instanceId]);
		press(panel, 'Push to main component');
		expect(widthOf(panel, mainChild)).toBe(5);
		expect(widthOf(panel, otherCopy)).toBe(5);
		expect(panel.ctx.document.require(copyId).touched).toEqual([]);
		panel.undo();
		expect(widthOf(panel, mainChild)).toBe(10);
		expect(widthOf(panel, otherCopy)).toBe(10);
		expect(widthOf(panel, copyId)).toBe(5);
	});

	it('goes to a main component on another page', async () => {
		const panel = await open();
		const { mainId, instanceId } = await instanceWithOverride(panel);
		const mainPage = panel.ctx.document.pageOf(mainId).id;
		const otherPage = panel.ctx.document.createPage('Other');
		panel.ctx.document.apply(panel.ctx.document.moveNode(instanceId, otherPage, 0), {
			origin: 'user',
			label: 'Move instance'
		});
		expect(panel.ctx.document.currentPageId).toBe(otherPage);
		panel.select([instanceId]);
		await panel.ctx.commands.run('components.go-to-main');
		expect(panel.ctx.document.currentPageId).toBe(mainPage);
		expect([...panel.ctx.selection.ids]).toEqual([mainId]);
	});

	it('restores a deleted main component with its old id, undoable', async () => {
		const panel = await open();
		const { mainId, instanceId } = await instanceWithOverride(panel);
		panel.ctx.document.apply(panel.ctx.document.removeNode(mainId), {
			origin: 'user',
			label: 'Delete main'
		});
		panel.select([instanceId]);
		expect(panel.ctx.contextKeys.get('selectionHasOrphan')).toBe(true);
		expect(panel.query('[data-instance-main]')?.textContent).toBe('Main component deleted');
		press(panel, 'Restore main component');
		expect(panel.ctx.document.require(mainId).type).toBe('COMPONENT');
		expect([...panel.ctx.selection.ids]).toEqual([mainId]);
		panel.undo();
		expect(panel.ctx.document.has(mainId)).toBe(false);
	});
});
