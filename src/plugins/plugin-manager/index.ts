import type { Context } from '@neoworks/extension-system';
import { PluginManagerService } from '../../lib/services/pluginManager';
import { PluginManagerState } from '../../lib/services/pluginManagerState.svelte';
import type { PaletteItem } from '../command-palette/service';
import PluginManagerDialog from './PluginManagerDialog.svelte';

// Third-party plugins, part nine (#161): the plugin manager. A dialog (command `plugin-manager.open`,
// Ctrl+Alt+P, Plugins menu) lists every installed plugin with its state and lets the user turn it
// off and on, run its commands, restart it, change what it may do, remove it, show its folder,
// install a folder or `.zip` (or drop one on the dialog) and decide whether to trust the plugins of
// the project. Installed plugins also appear, with a Run button, in the Resources search (Shift+I).
//
// Turning a plugin off marks it `disabled` in the registry, so the manifest loader unloads its
// stubs and its worker: every effect the plugin had is reverted. The choice is stored by main with
// the permission decisions and applied again on the next start.
export default {
	name: 'plugin-manager',
	inject: [
		'pluginRegistry',
		'pluginHost',
		'pluginPermissions',
		'desktop',
		'commands',
		'keymap',
		'menus',
		'regions',
		'resourceSearch'
	],
	apply(ctx: Context): void {
		const manager = new PluginManagerService(
			ctx,
			new PluginManagerState(),
			ctx.pluginRegistry,
			ctx.pluginHost,
			ctx.pluginPermissions,
			{
				installFromDialog: (kind) => ctx.desktop.pluginsInstallFromDialog(kind),
				install: (path) => ctx.desktop.pluginsInstall(path),
				remove: (directoryName) => ctx.desktop.pluginsRemove(directoryName),
				reveal: (source, directoryName) => ctx.desktop.pluginsReveal(source, directoryName),
				setTrust: (trusted) => ctx.desktop.pluginsSetTrust(trusted)
			}
		);

		ctx.effect(() => {
			let release = ctx.pluginRegistry.setDisabled(ctx.pluginPermissions.disabledIds());
			const stop = ctx.on('plugins/decisions-changed', () => {
				release = ctx.pluginRegistry.setDisabled(ctx.pluginPermissions.disabledIds());
			});
			return () => {
				void stop();
				release();
			};
		}, 'plugin-manager disabled plugins');

		ctx.desktop.on('plugins:changed', (list) => manager.adoptList(list));
		ctx.desktop
			.pluginsList()
			.then((list) => manager.adoptList(list))
			.catch((error: unknown) => ctx.logger.error(error));

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'plugin-manager.open',
					title: 'Manage plugins...',
					run: () => manager.toggleDialog()
				}),
			'command plugin-manager.open'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+Alt+P',
					command: 'plugin-manager.open',
					scope: 'global',
					source: 'plugin-manager'
				}),
			'shortcut Mod+Alt+P plugin manager'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/plugins',
					item: {
						id: 'plugin-manager',
						command: 'plugin-manager.open',
						group: '0_manage',
						order: 0
					}
				}),
			'menu app/plugins manage'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'plugin-manager/dialog',
					region: 'overlay',
					component: PluginManagerDialog
				}),
			'plugin manager dialog'
		);
		ctx.effect(
			() =>
				ctx.resourceSearch.registerProvider({
					id: 'plugin-manager/plugins',
					items: (): PaletteItem[] =>
						manager.runnableRows().map((row) => ({
							id: `plugin:${row.id}`,
							title: row.name,
							subtitle: ['Plugin', row.version, row.description]
								.filter((part) => part !== '')
								.join(' · '),
							actionLabel: 'Run',
							run: () => manager.run(row.id, row.commands[0].id)
						}))
				}),
			'resources plugins'
		);
	}
};
