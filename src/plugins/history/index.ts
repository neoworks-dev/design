import type { Context } from '@neoworks/extension-system';
import { HistoryService, type HistoryOptions } from '../../lib/services/history';
import { HistoryState } from '../../lib/services/historyState.svelte';
import { publishHistoryContextKeys } from './contextKeys';

// Undo and redo over document transactions. Reads document events (begin, change, replace), owns
// the stack, replays through `document.apply`. Commands `edit.undo` and `edit.redo` carry the
// shortcuts; they are global-scope, so a focused text field keeps its own native undo.
export default {
	name: 'history',
	inject: ['document', 'selection', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context, config?: HistoryOptions): void {
		const history = new HistoryService(
			ctx,
			ctx.document,
			ctx.selection,
			new HistoryState(),
			config
		);

		ctx.on('document/begin', () => history.captureSelection());
		ctx.on('document/change', (event) => history.record(event));
		ctx.on('document/replace', () => history.handleDocumentReplace());

		publishHistoryContextKeys(ctx, history);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'edit.undo',
					title: 'Undo',
					when: 'canUndo',
					run: () => {
						history.undo();
					}
				}),
			'command edit.undo'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'edit.redo',
					title: 'Redo',
					when: 'canRedo',
					run: () => {
						history.redo();
					}
				}),
			'command edit.redo'
		);

		ctx.effect(
			() => ctx.keymap.register({ key: 'Mod+Z', command: 'edit.undo', scope: 'global' }),
			'keymap edit.undo'
		);
		ctx.effect(
			() => ctx.keymap.register({ key: 'Mod+Shift+Z', command: 'edit.redo', scope: 'global' }),
			'keymap edit.redo'
		);
		// Ctrl+Y is redo on Windows and most Linux apps; on macOS Ctrl+Y is not a redo.
		if (ctx.keymap.platform !== 'darwin') {
			ctx.effect(
				() => ctx.keymap.register({ key: 'Ctrl+Y', command: 'edit.redo', scope: 'global' }),
				'keymap edit.redo (Ctrl+Y)'
			);
		}
	}
};
