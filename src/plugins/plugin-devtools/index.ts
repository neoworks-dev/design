import type { Context } from '@neoworks/extension-system';
import { PluginConsoleService } from '../../lib/services/pluginConsole';
import { PluginConsoleState } from '../../lib/services/pluginConsoleState.svelte';
import CreatePluginDialog from './CreatePluginDialog.svelte';
import PluginConsole from './PluginConsole.svelte';

// Third-party plugins, part ten (#162): the developer's tools. The plugin console (Ctrl+Alt+J)
// shows what every plugin prints and the errors of their code (traces mapped through the plugin's
// `main.js.map`); when a plugin's files change on disk, main runs its manifest `build` command and
// the plugin restarts here, so the old worker and everything it registered are gone and the new
// version takes over; "Create plugin" writes a plugin from a template into the user plugins folder.
export default {
	name: 'plugin-devtools',
	inject: ['pluginRegistry', 'pluginHost', 'desktop', 'commands', 'keymap', 'menus', 'regions'],
	apply(ctx: Context): void {
		const devtools = new PluginConsoleService(
			ctx,
			new PluginConsoleState(),
			ctx.pluginRegistry,
			ctx.pluginHost,
			{
				readSourceMap: async (pluginId) => {
					const record = ctx.pluginRegistry.get(pluginId);
					if (record === undefined || record.manifest === null) return undefined;
					return ctx.desktop.pluginsReadFile(
						record.source,
						record.directoryName,
						`${record.manifest.main}.map`
					);
				},
				create: (id, name, template) => ctx.desktop.pluginsCreate(id, name, template)
			}
		);

		ctx.effect(
			() =>
				ctx.pluginHost.onLog((connection, line) =>
					devtools.append(connection.pluginId, line.level, line.message)
				),
			'plugin-devtools mirror plugin logs'
		);
		ctx.on('plugins/failed', (pluginId, reason) => devtools.append(pluginId, 'error', reason));
		ctx.desktop.on('plugins:reload', (message) => {
			devtools.handleReload(message).catch((error: unknown) => ctx.logger.error(error));
		});

		const commands: { id: string; title: string; run: () => void | Promise<void> }[] = [
			{
				id: 'plugin-devtools.console',
				title: 'Plugin console',
				run: () => devtools.toggleConsole()
			},
			{
				id: 'plugin-devtools.create',
				title: 'Create plugin...',
				run: () => devtools.openCreate()
			},
			{
				id: 'plugin-devtools.reload',
				title: 'Reload running plugins',
				run: () => devtools.restartAll()
			}
		];
		for (const command of commands) {
			ctx.effect(() => ctx.commands.register(command), `command ${command.id}`);
		}
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+Alt+J',
					command: 'plugin-devtools.console',
					scope: 'global',
					source: 'plugin-devtools'
				}),
			'shortcut Mod+Alt+J plugin console'
		);
		const menuItems = [
			{ id: 'plugin-devtools.console', order: 0 },
			{ id: 'plugin-devtools.create', order: 1 },
			{ id: 'plugin-devtools.reload', order: 2 }
		];
		for (const item of menuItems) {
			ctx.effect(
				() =>
					ctx.menus.register({
						menu: 'app/plugins',
						item: { id: item.id, command: item.id, group: '2_develop', order: item.order }
					}),
				`menu app/plugins ${item.id}`
			);
		}
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'plugin-devtools/console',
					region: 'overlay',
					component: PluginConsole
				}),
			'plugin console'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'plugin-devtools/create',
					region: 'overlay',
					component: CreatePluginDialog
				}),
			'create plugin dialog'
		);
	}
};
