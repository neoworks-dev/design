// Publishes component facts about the selection to the context keys, for `when` clauses:
//   canCreateComponent       something selected can become a component (not inside an instance)
//   selectionHasInstance     the selection is, or is inside, an instance
//   selectionHasMain         the selection includes a main component
//   selectionHasOrphan       an instance in the selection lost its main component
//   selectionHasOverrides    an instance in the selection overrides something
//   selectionHasVariants     the selection includes a component set or a variant

import type { Context } from '@neoworks/extension-system';
import { hasOverrides, instanceOf, overriddenBelow } from '../document';
import { canMakeComponent } from '../editing/componentEdit';

function selectedNodes(ctx: Context): ReturnType<Context['selection']['nodes']> {
	return ctx.selection.nodes();
}

function hasOverridesIn(ctx: Context): boolean {
	const reader = ctx.document.reader;
	for (const node of selectedNodes(ctx)) {
		const instance = instanceOf(reader, node.id);
		if (instance === undefined) continue;
		if (hasOverrides(instance)) return true;
		if (overriddenBelow(reader, node.id).length > 0) return true;
	}
	return false;
}

function hasOrphan(ctx: Context): boolean {
	return selectedNodes(ctx).some((node) => ctx.componentSync.isOrphan(node.id));
}

function hasVariants(ctx: Context): boolean {
	return selectedNodes(ctx).some((node) => {
		if (node.type === 'COMPONENT_SET') return true;
		return ctx.componentSync.variantSetOf(node.id) !== undefined;
	});
}

function publish(ctx: Context): Array<() => void> {
	const reader = ctx.document.reader;
	const nodes = selectedNodes(ctx);
	return [
		ctx.contextKeys.set(
			'canCreateComponent',
			nodes.some((node) => canMakeComponent(reader, node))
		),
		ctx.contextKeys.set(
			'selectionHasInstance',
			nodes.some((node) => instanceOf(reader, node.id) !== undefined)
		),
		ctx.contextKeys.set(
			'selectionHasMain',
			nodes.some((node) => node.type === 'COMPONENT')
		),
		ctx.contextKeys.set('selectionHasOrphan', hasOrphan(ctx)),
		ctx.contextKeys.set('selectionHasOverrides', hasOverridesIn(ctx)),
		ctx.contextKeys.set('selectionHasVariants', hasVariants(ctx))
	];
}

export function publishComponentContextKeys(ctx: Context): void {
	// Each publish replaces the keys' entries, so older disposers are no-ops (dispose by
	// identity) and only the latest ones unset the keys on unmount.
	let disposers: Array<() => void> = [];
	const update = (): void => {
		disposers = publish(ctx);
	};
	ctx.effect(() => {
		update();
		return () => disposers.forEach((dispose) => dispose());
	}, 'component context keys');
	ctx.on('selection/change', update);
	ctx.on('document/change', update);
}
