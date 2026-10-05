import type { Context } from '@neoworks/extension-system';
import { AssetsPanelState } from '../../lib/services/assetsPanelState.svelte';
import { AssetsPanelService } from '../../lib/services/assetsPanel';
import AssetsTab from './AssetsTab.svelte';

/** What the context menus of the panel pass to their commands: the asset's id. */
interface AssetTarget {
	id: string;
}

function isAssetTarget(args: unknown): args is AssetTarget {
	if (typeof args !== 'object' || args === null) return false;
	return typeof Reflect.get(args, 'id') === 'string';
}

interface AssetCommand {
	id: string;
	title: string;
	run: (service: AssetsPanelService, assetId: string) => void;
}

const COMPONENT_MENU = 'context/asset-component';
const STYLE_MENU = 'context/asset-style';
const PAINT_STYLE_MENU = 'context/asset-paint-style';

const COMMANDS: AssetCommand[] = [
	{
		id: 'assets.component.go-to-main',
		title: 'Go to main component',
		run: (service, id) => service.goToMain(id)
	},
	{
		id: 'assets.component.insert',
		title: 'Insert instance',
		run: (service, id) => void service.insertAtDefault(id)
	},
	{
		id: 'assets.component.delete',
		title: 'Delete component',
		run: (service, id) => service.deleteComponent(id)
	},
	{
		id: 'assets.style.apply',
		title: 'Apply style',
		run: (service, id) => service.applyStyle(id)
	},
	{
		id: 'assets.style.apply-stroke',
		title: 'Apply as stroke',
		run: (service, id) => service.applyStyle(id, 'stroke')
	},
	{
		id: 'assets.style.rename',
		title: 'Rename style',
		run: (service, id) => service.startRenamingStyle(id)
	},
	{
		id: 'assets.style.delete',
		title: 'Delete style',
		run: (service, id) => service.deleteStyle(id)
	}
];

interface AssetMenuItem {
	menu: string;
	command: string;
	group: string;
	order: number;
}

const MENU_ITEMS: AssetMenuItem[] = [
	{ menu: COMPONENT_MENU, command: 'assets.component.insert', group: '1_insert', order: 0 },
	{ menu: COMPONENT_MENU, command: 'assets.component.go-to-main', group: '2_edit', order: 0 },
	{ menu: COMPONENT_MENU, command: 'assets.component.delete', group: '9_delete', order: 0 },
	{ menu: STYLE_MENU, command: 'assets.style.apply', group: '1_apply', order: 0 },
	{ menu: STYLE_MENU, command: 'assets.style.rename', group: '2_edit', order: 0 },
	{ menu: STYLE_MENU, command: 'assets.style.delete', group: '9_delete', order: 0 },
	{ menu: PAINT_STYLE_MENU, command: 'assets.style.apply', group: '1_apply', order: 0 },
	{ menu: PAINT_STYLE_MENU, command: 'assets.style.apply-stroke', group: '1_apply', order: 1 },
	{ menu: PAINT_STYLE_MENU, command: 'assets.style.rename', group: '2_edit', order: 0 },
	{ menu: PAINT_STYLE_MENU, command: 'assets.style.delete', group: '9_delete', order: 0 }
];

// The assets panel (#79): the "Assets" tab of the left sidebar with the components and styles of
// the open file (a single-file library, data-model.md section 7), a search field, drag onto the
// canvas to insert an instance, double click or Enter to insert at the middle of the selected
// frame, and context menus (edit = go to main component, rename, delete). Provides
// `ctx.assetsPanel`.
export default {
	name: 'assets-panel',
	inject: [
		'panels',
		'document',
		'selection',
		'commands',
		'menus',
		'componentSync',
		'styles',
		'viewport',
		'hitTest'
	],
	apply(ctx: Context): void {
		const service = new AssetsPanelService(ctx, new AssetsPanelState());

		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: 'assets',
					side: 'left',
					title: 'Assets',
					order: 1,
					shortcut: 'Alt+2',
					component: AssetsTab
				}),
			'assets tab'
		);

		for (const command of COMMANDS) {
			ctx.effect(
				() =>
					ctx.commands.register({
						id: command.id,
						title: command.title,
						run: (args) => {
							if (!isAssetTarget(args)) return;
							command.run(service, args.id);
						}
					}),
				`command ${command.id}`
			);
		}
		for (const item of MENU_ITEMS) {
			ctx.effect(
				() =>
					ctx.menus.register({
						menu: item.menu,
						item: {
							id: item.command,
							command: item.command,
							group: item.group,
							order: item.order
						}
					}),
				`menu ${item.menu} ${item.command}`
			);
		}
	}
};
