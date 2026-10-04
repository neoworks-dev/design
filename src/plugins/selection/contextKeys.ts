// Publishes selection facts to the context keys, so `when` clauses of commands, menus and keymap
// can read them without importing the selection plugin:
//   hasSelection    boolean
//   selectionCount  number
//   selectionKind   'none' | a node type | 'mixed'

import type { Context } from '@neoworks/extension-system';
import type { SelectionService } from '../../lib/services/selection';

function publish(ctx: Context, selection: SelectionService): Array<() => void> {
	const summary = selection.summary();
	return [
		ctx.contextKeys.set('hasSelection', summary.count > 0),
		ctx.contextKeys.set('selectionCount', summary.count),
		ctx.contextKeys.set('selectionKind', summary.kind)
	];
}

export function publishSelectionContextKeys(ctx: Context, selection: SelectionService): void {
	// Each publish replaces the key's entry, so an older disposer is a no-op (dispose by
	// identity) and only the latest ones unset the keys on unmount.
	let disposers: Array<() => void> = [];
	ctx.effect(() => {
		disposers = publish(ctx, selection);
		return () => disposers.forEach((dispose) => dispose());
	}, 'selection context keys');
	ctx.on('selection/change', () => {
		disposers = publish(ctx, selection);
	});
}
