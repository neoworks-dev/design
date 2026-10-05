// What the variant commands and controls do, as functions of the plugin's `ctx`: each applies one
// change list (one undo step) and fixes the selection. Always call with the plugin's own `ctx`.

import type { Context } from '@neoworks/extension-system';
import {
	planAddVariant,
	planAddVariantProperty,
	planChangeVariantProperty,
	planCreateVariantSet,
	planSetVariantValue,
	variantSetOf,
	type Change,
	type NodeId
} from '../document';
import { applyEdit } from '../editing/contribute';
import { planCreateComponents } from '../editing/componentEdit';

/** Component ids the selection stands for: selected mains, and frames and groups to convert. */
function componentCandidates(ctx: Context): { mains: NodeId[]; convertible: NodeId[] } {
	const mains: NodeId[] = [];
	const convertible: NodeId[] = [];
	for (const node of ctx.selection.nodes()) {
		if (node.type === 'COMPONENT' && variantSetOf(ctx.document.reader, node.id) === undefined) {
			mains.push(node.id);
		}
		if (node.type === 'FRAME' || node.type === 'GROUP') convertible.push(node.id);
	}
	return { mains, convertible };
}

/**
 * Combine the selected components (frames and groups become components first) into a component
 * set, as one undo step.
 */
export function combineAsVariants(ctx: Context): void {
	const { mains, convertible } = componentCandidates(ctx);
	if (mains.length + convertible.length === 0) return;
	let setId: NodeId | undefined;
	ctx.document.transaction({ origin: 'user', label: 'Combine as variants' }, () => {
		const componentIds = [...mains];
		if (convertible.length > 0) {
			const plan = planCreateComponents(ctx.document.reader, convertible);
			if (plan !== null) {
				ctx.document.apply(plan.changes, { origin: 'user', label: 'Create component' });
				componentIds.push(...plan.componentIds);
			}
		}
		if (componentIds.length === 0) return;
		const set = planCreateVariantSet(ctx.document.reader, componentIds);
		ctx.document.apply(set.changes, { origin: 'user', label: 'Combine as variants' });
		setId = set.setId;
	});
	if (setId !== undefined) ctx.selection.select([setId]);
}

/** The set a selected set or variant belongs to. */
export function selectedSetId(ctx: Context): NodeId | undefined {
	const [id] = ctx.selection.ids;
	if (id === undefined) return undefined;
	const node = ctx.document.get(id);
	if (node === undefined) return undefined;
	if (node.type === 'COMPONENT_SET') return node.id;
	return variantSetOf(ctx.document.reader, id)?.id;
}

/** Add a variant to the set of the selection (a copy of the selected variant, or the last). */
export function addVariant(ctx: Context, setId = selectedSetId(ctx)): void {
	if (setId === undefined) return;
	const [selected] = ctx.selection.ids;
	let source: NodeId | undefined;
	if (selected !== undefined && variantSetOf(ctx.document.reader, selected) !== undefined) {
		source = selected;
	}
	const plan = planAddVariant(ctx.document.reader, setId, source);
	if (!applyEdit(ctx, plan.changes, 'Add variant')) return;
	ctx.selection.select([plan.variantId]);
}

export function addVariantProperty(ctx: Context, setId: NodeId): void {
	const set = ctx.document.get(setId);
	if (set === undefined || set.type !== 'COMPONENT_SET') return;
	const count = Object.keys(set.componentPropertyDefinitions).length + 1;
	const plan = planAddVariantProperty(ctx.document.reader, setId, `Property ${count}`);
	applyEdit(ctx, plan.changes, 'Add variant property');
}

export function renameVariantProperty(
	ctx: Context,
	setId: NodeId,
	key: string,
	name: string
): void {
	applyEdit(
		ctx,
		planChangeVariantProperty(ctx.document.reader, setId, key, name),
		'Rename variant property'
	);
}

export function deleteVariantProperty(ctx: Context, setId: NodeId, key: string): void {
	applyEdit(
		ctx,
		planChangeVariantProperty(ctx.document.reader, setId, key, undefined),
		'Delete variant property'
	);
}

export function setVariantValue(ctx: Context, variantId: NodeId, key: string, value: string): void {
	applyEdit(
		ctx,
		planSetVariantValue(ctx.document.reader, variantId, key, value),
		'Change variant property'
	);
}

/** Switch an instance to another variant by changing one variant property. */
export function switchInstanceVariant(
	ctx: Context,
	instanceId: NodeId,
	key: string,
	value: string
): void {
	const instance = ctx.document.get(instanceId);
	if (instance === undefined || instance.type !== 'INSTANCE') return;
	const changes: Change[] = ctx.document.setProps(instanceId, {
		componentProperties: {
			...instance.componentProperties,
			[key]: { type: 'VARIANT', value }
		}
	});
	applyEdit(ctx, changes, 'Switch variant');
}
