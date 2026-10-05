import type { Context } from '@neoworks/extension-system';
import { ExportDialogService } from '../../lib/services/exportDialog';
import { ExportDialogState } from '../../lib/services/exportDialogState.svelte';
import ExportDialog from './ExportDialog.svelte';
import ExportActions from './ExportActions.svelte';
import ExportSection from './ExportSection.svelte';

// The Export section of the Design tab and the export dialog (#129). Settings are edited through
// `export` (document data, undoable); the dialog's own choices (assets, file type, size) are
// dialog-local, so Cancel leaves the document untouched. Mod+Shift+E opens the dialog.
export default {
	name: 'export-ui',
	inject: [
		'inspectors',
		'export',
		'selection',
		'document',
		'commands',
		'keymap',
		'regions',
		'menus'
	],
	apply(ctx: Context): void {
		const dialog = new ExportDialogService(ctx, new ExportDialogState());

		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'export',
					tab: 'design',
					title: 'Export',
					order: 90,
					applies: (selection) => selection.count > 0,
					component: ExportSection,
					actions: ExportActions
				}),
			'export section'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'export.dialog',
					title: 'Export...',
					run: () => dialog.toggle()
				}),
			'command export.dialog'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+Shift+E',
					command: 'export.dialog',
					scope: 'global'
				}),
			'shortcut Mod+Shift+E export dialog'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: { id: 'export.dialog', command: 'export.dialog', group: '8_export', order: 1 }
				}),
			'menu app/file export'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'export-ui/dialog',
					region: 'overlay',
					component: ExportDialog
				}),
			'export dialog'
		);

		// An open dialog must not outlive the plugin (and its preview URL must be released).
		ctx.effect(() => () => dialog.close(), 'export-ui/close on unload');
	}
};
