// Instance swap as a function of the plugin's `ctx` (like the rest of `actions.ts`): replace the
// instance at or above a layer by an instance of another main component. The planning is
// `planSwap` (touched groups carry over by name path); this applies it as one undo step. A swap
// that would put a component inside itself throws the engine's `ComponentCycleError`; callers
// show the message.

import type { Context } from '@neoworks/extension-system';
import { planSwap, type NodeId } from '../document';
import { applyEdit } from '../editing/contribute';

/** Returns the swapped instance (it keeps its id), or `undefined` when nothing changed. */
export function swapInstance(ctx: Context, targetId: NodeId, mainId: NodeId): NodeId | undefined {
	const instance = ctx.componentSync.instanceOf(targetId);
	if (instance === undefined) return undefined;
	const changes = planSwap(ctx.document.reader, instance.id, mainId);
	if (!applyEdit(ctx, changes, 'Swap instance')) return undefined;
	ctx.selection.select([instance.id]);
	return instance.id;
}
