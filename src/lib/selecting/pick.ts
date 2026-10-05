// What a pointer press or hover resolves to on the canvas, and what a double click enters. Pure
// decisions over the `hitTest` and `selection` services (docs/research/interactions.md
// section 3): a click selects the topmost object at the current scope, a top-level frame is
// picked by its title label, Ctrl/Cmd picks the deepest object, double click goes one level
// into the selected container.

import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import { hasImageFill } from '../editing/imageCrop';
import type { Modifiers, Point } from '../tools/protocol';

/** Screen pixels of slack around the pointer when hit testing. */
export const HIT_TOLERANCE_PIXELS = 3;

function queryAt(ctx: Context, world: Point): { point: Point; tolerance: number } {
	return { point: world, tolerance: HIT_TOLERANCE_PIXELS / ctx.viewport.zoom };
}

export function isDeepSelect(modifiers: Modifiers): boolean {
	return modifiers.ctrlKey || modifiers.metaKey;
}

/** The node a click at `world` would select, or undefined for empty canvas. */
export function pickAt(ctx: Context, world: Point, modifiers: Modifiers): NodeId | undefined {
	const query = queryAt(ctx, world);
	if (isDeepSelect(modifiers)) return ctx.hitTest.deepest(query);
	const title = ctx.hitTest.frameTitle(query, ctx.viewport.zoom);
	if (title !== undefined) return title;
	return ctx.hitTest.topAtScope(query);
}

/** The child of `containerId` on the path to the topmost node under the pointer, if any. */
export function childUnder(ctx: Context, containerId: NodeId, world: Point): NodeId | undefined {
	for (const hitId of ctx.hitTest.all(queryAt(ctx, world))) {
		const chain = [ctx.document.require(hitId), ...ctx.document.ancestors(hitId)];
		const position = chain.findIndex((node) => node.id === containerId);
		if (position > 0) return chain[position - 1].id;
	}
	return undefined;
}

export type EnterResult =
	| { kind: 'entered'; id: NodeId }
	| { kind: 'edit'; id: NodeId; editor: 'text' | 'vector' | 'crop' }
	| { kind: 'none' };

/**
 * Double click: select the child under the pointer, or ask to edit text and vector nodes.
 * Alt+double click on an image crops it.
 */
export function enterAt(ctx: Context, world: Point, modifiers?: Modifiers): EnterResult {
	const selectedId = ctx.selection.primaryId;
	if (selectedId === null) return { kind: 'none' };
	const selected = ctx.document.require(selectedId);
	if (selected.type === 'TEXT') return { kind: 'edit', id: selectedId, editor: 'text' };
	if (selected.type === 'VECTOR') return { kind: 'edit', id: selectedId, editor: 'vector' };
	if (modifiers?.altKey === true && hasImageFill(selected)) {
		return { kind: 'edit', id: selectedId, editor: 'crop' };
	}
	const childId = childUnder(ctx, selectedId, world);
	if (childId === undefined) return { kind: 'none' };
	return { kind: 'entered', id: childId };
}
