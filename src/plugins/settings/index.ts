import type { Context, Fiber } from '@neoworks/extension-system';
import { SettingsService } from '../../lib/services/settings';
import { SettingsState } from '../../lib/services/settingsState.svelte';
import { coreSettingsSchema } from './coreSchema';
import SettingsDialog from './SettingsDialog.svelte';

function applyTheme(settings: SettingsService): void {
	const theme = settings.core('theme');
	if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}

// The `settings` service and its dialog (Mod+,). Preferences are stored by main in the user data
// directory. Each plugin's settings are its `Config` schema: the dialog is generated from those
// schemas, an edit is `fiber.update` on that plugin only, and every `fiber.update` (a toggle
// command updating its own plugin too) is persisted through one hook. Stored values reach plugins
// when the preferences are read, and plugins that mount later get them as they become active.
export default {
	name: 'settings',
	inject: ['desktop', 'regions', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		const settings = new SettingsService(ctx, ctx.desktop, new SettingsState());

		ctx.effect(() => settings.registerCoreSchema(coreSettingsSchema), 'settings/core schema');

		ctx.on(
			'internal/update',
			function (this: Fiber, config, noSave, next) {
				const restarting = next();
				settings.recordUpdate(this, config, noSave);
				return restarting;
			},
			{ global: true }
		);
		ctx.on(
			'internal/status',
			(fiber) => {
				void Promise.resolve().then(() => settings.applyStored(fiber));
			},
			{ global: true }
		);

		ctx.effect(() => {
			const root = document.documentElement;
			const original = root.dataset.theme;
			applyTheme(settings);
			return () => {
				if (original === undefined) delete root.dataset.theme;
				else root.dataset.theme = original;
			};
		}, 'settings/theme');
		ctx.on('settings/core-changed', () => applyTheme(settings));

		ctx.effect(() => {
			settings.load().catch((error: unknown) => ctx.logger.error('settings', error));
			return () => settings.closeDialog();
		}, 'settings/load');

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'settings.open',
					title: 'Settings...',
					run: () => settings.openDialog()
				}),
			'command settings.open'
		);
		ctx.effect(
			() => ctx.keymap.register({ key: 'Mod+,', command: 'settings.open', scope: 'global' }),
			'shortcut Mod+,'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: { id: 'settings', command: 'settings.open', group: '9_settings', order: 0 }
				}),
			'menu app/file settings'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'settings/dialog',
					region: 'overlay',
					component: SettingsDialog
				}),
			'settings dialog'
		);
	}
};
