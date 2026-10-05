// What the component property controls do, as functions of the plugin's `ctx`: each applies one
// change list (one undo step). Always call with the plugin's own `ctx`.

import type { Context } from '@neoworks/extension-system';
import {
	boundLayerValue,
	definitionsOf,
	layerPropsFor,
	planAddProperty,
	planBindLayer,
	planDeleteProperty,
	planRenameProperty,
	planSetPropertyDefault,
	planSetProps,
	planSwap,
	type Change,
	type ComponentPropertyTarget,
	type ComponentPropertyType,
	type ComponentPropertyValue,
	type NewProperty,
	type NodeId
} from '../document';
import { applyEdit } from '../editing/contribute';

export type CreatableType = NewProperty['type'];

export const PROPERTY_TYPES: { value: CreatableType; label: string }[] = [
	{ value: 'BOOLEAN', label: 'Boolean' },
	{ value: 'TEXT', label: 'Text' },
	{ value: 'INSTANCE_SWAP', label: 'Instance swap' }
];

/** The property type a layer binding target is driven by. */
export function typeOfTarget(target: ComponentPropertyTarget): CreatableType {
	if (target === 'visible') return 'BOOLEAN';
	if (target === 'characters') return 'TEXT';
	return 'INSTANCE_SWAP';
}

/** Default value for a new property of `type`, taken from `layerId` when it is bound to one. */
export function initialValue(
	ctx: Context,
	type: ComponentPropertyType,
	layerId?: NodeId
): boolean | string {
	if (layerId !== undefined && ctx.document.has(layerId)) {
		const value = boundLayerValue(ctx.document.reader, layerId, type);
		if (value !== undefined) return value;
	}
	if (type === 'BOOLEAN') return true;
	return '';
}

export function createProperty(
	ctx: Context,
	mainId: NodeId,
	spec: NewProperty
): string | undefined {
	const plan = planAddProperty(ctx.document.reader, mainId, spec);
	if (!applyEdit(ctx, plan.changes, 'Create component property')) return undefined;
	return plan.key;
}

export function deleteProperty(ctx: Context, mainId: NodeId, key: string): void {
	applyEdit(ctx, planDeleteProperty(ctx.document.reader, mainId, key), 'Delete component property');
}

export function renameProperty(ctx: Context, mainId: NodeId, key: string, name: string): void {
	const plan = planRenameProperty(ctx.document.reader, mainId, key, name);
	applyEdit(ctx, plan.changes, 'Rename component property');
}

export function setDefaultValue(
	ctx: Context,
	mainId: NodeId,
	key: string,
	value: boolean | string
): void {
	const changes = planSetPropertyDefault(ctx.document.reader, mainId, key, value);
	applyEdit(ctx, changes, 'Change component property default');
}

/** Bind a layer of a main component to a property (or unbind with `undefined`). */
export function bindLayer(
	ctx: Context,
	layerId: NodeId,
	target: ComponentPropertyTarget,
	mainId: NodeId,
	key: string | undefined
): void {
	const reader = ctx.document.reader;
	const changes: Change[] = planBindLayer(reader, layerId, target, key);
	const definition = key === undefined ? undefined : definitionsOf(reader, mainId)[key];
	if (definition !== undefined) {
		const layer = reader.requireNode(layerId);
		if (target === 'mainComponent') {
			const swapTo = definition.defaultValue;
			if (typeof swapTo === 'string' && reader.hasNode(swapTo)) {
				changes.push(...planSwap(reader, layerId, swapTo));
			}
		} else {
			changes.push(
				...planSetProps(reader, layerId, layerPropsFor(layer, target, definition.defaultValue))
			);
		}
	}
	applyEdit(ctx, changes, 'Bind layer to component property');
}

/** Set one value of an instance; the bound layers follow (the sync engine, in the same step). */
export function setInstanceValue(
	ctx: Context,
	instanceId: NodeId,
	key: string,
	value: boolean | string
): void {
	const instance = ctx.document.get(instanceId);
	if (instance === undefined || instance.type !== 'INSTANCE') return;
	const current: ComponentPropertyValue | undefined = instance.componentProperties[key];
	if (current === undefined) return;
	const changes = ctx.document.setProps(instanceId, {
		componentProperties: { ...instance.componentProperties, [key]: { ...current, value } }
	});
	applyEdit(ctx, changes, 'Change component property');
}

/** The property type a layer can be bound to, by what the layer is. */
export function bindableTargets(ctx: Context, layerId: NodeId): ComponentPropertyTarget[] {
	const layer = ctx.document.get(layerId);
	if (layer === undefined) return [];
	const targets: ComponentPropertyTarget[] = [];
	if ('visible' in layer) targets.push('visible');
	if (layer.type === 'TEXT') targets.push('characters');
	if (layer.type === 'INSTANCE') targets.push('mainComponent');
	return targets;
}
