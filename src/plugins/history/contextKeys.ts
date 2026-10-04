// Publishes `canUndo` and `canRedo` so the commands' `when` clauses, menus and keymap follow the
// stacks without importing the history plugin.

import type { Context } from '@neoworks/extension-system';
import type { HistoryService } from '../../lib/services/history';

function publish(ctx: Context, history: HistoryService): Array<() => void> {
	return [
		ctx.contextKeys.set('canUndo', history.canUndo),
		ctx.contextKeys.set('canRedo', history.canRedo)
	];
}

export function publishHistoryContextKeys(ctx: Context, history: HistoryService): void {
	// A newer publish replaces the entry, so an older disposer is a no-op (dispose by identity).
	let disposers: Array<() => void> = [];
	ctx.effect(() => {
		disposers = publish(ctx, history);
		return () => disposers.forEach((dispose) => dispose());
	}, 'history context keys');
	ctx.on('history/change', () => {
		disposers = publish(ctx, history);
	});
}
