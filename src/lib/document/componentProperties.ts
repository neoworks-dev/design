// Component properties: definitions on main components (boolean, text, instance swap; variant
// properties are in componentVariants.ts), bindings of layers to them, and what happens to an
// instance when one of its values changes.
//
// Definitions live on the main component, or on its component set for variants; property keys
// are the property names. Instances store values in `componentProperties`.

import {
	boundLayers,
	layerPropsFor,
	layerValueFor,
	referenceEntries,
	TARGET_OF_TYPE,
	touchedGroupOfTarget,
	withTouchedGroup
} from './componentBindings';
import { definitionsOf, findVariant, variantSetOf, variantsOf } from './componentDefinitions';
import { planSwap } from './componentSwap';
import { planSetProps } from './changes';
import type { IdGenerator } from './ids';
import type { DocumentReader } from './store';
import type {
	Change,
	ComponentPropertyDefinition,
	ComponentPropertyTarget,
	ComponentPropertyType,
	ComponentPropertyValue,
	Node,
	NodeId
} from './types';

/** The mains that share property definitions: the variants of its set, or just itself. */
export function propertyFamily(reader: DocumentReader, mainId: NodeId): NodeId[] {
	const set = variantSetOf(reader, mainId);
	if (set === undefined) return [mainId];
	return variantsOf(reader, set.id).map((variant) => variant.id);
}

/** The node whose `componentPropertyDefinitions` hold shared properties for `mainId`. */
export function definitionHolder(reader: DocumentReader, mainId: NodeId): Node {
	const set = variantSetOf(reader, mainId);
	if (set !== undefined) return set;
	return reader.requireNode(mainId);
}

function holderDefinitions(holder: Node): Record<string, ComponentPropertyDefinition> {
	if (holder.type === 'COMPONENT' || holder.type === 'COMPONENT_SET') {
		return holder.componentPropertyDefinitions;
	}
	throw new Error(`${holder.id} cannot hold component properties`);
}

/** Root instances (anywhere in the document) of any main in the family. */
export function instancesOfFamily(reader: DocumentReader, mainId: NodeId): Node[] {
	const family = new Set(propertyFamily(reader, mainId));
	const instances: Node[] = [];
	for (const node of Object.values(reader.nodes)) {
		if (node.type !== 'INSTANCE' || node.componentRef !== undefined) continue;
		if (family.has(node.mainComponentId)) instances.push(node);
	}
	return instances;
}

/** Every layer inside the family's mains, including the mains themselves. */
function familyLayers(reader: DocumentReader, mainId: NodeId): Node[] {
	const layers: Node[] = [];
	for (const id of propertyFamily(reader, mainId)) {
		layers.push(reader.requireNode(id), ...reader.descendants(id));
	}
	return layers;
}

function uniqueKey(existing: Record<string, unknown>, name: string): string {
	const base = name.trim();
	if (base === '') throw new Error('a property needs a name');
	if (!Object.hasOwn(existing, base)) return base;
	let number = 2;
	while (Object.hasOwn(existing, `${base} ${number}`)) number += 1;
	return `${base} ${number}`;
}

// ---------- definitions ----------

export interface NewProperty {
	name: string;
	type: Exclude<ComponentPropertyType, 'VARIANT' | 'SLOT'>;
	defaultValue: boolean | string;
	/** Layers of the main component to bind the property to. */
	layerIds?: NodeId[];
}

export interface PropertyPlan {
	key: string;
	changes: Change[];
}

function bindingChanges(
	reader: DocumentReader,
	layerId: NodeId,
	target: ComponentPropertyTarget,
	key: string | undefined
): Change[] {
	const layer = reader.requireNode(layerId);
	const references: Partial<Record<ComponentPropertyTarget, string>> = {
		...layer.componentPropertyReferences
	};
	if (key === undefined) Reflect.deleteProperty(references, target);
	else references[target] = key;
	const value = Object.keys(references).length === 0 ? undefined : references;
	return planSetProps(reader, layerId, { componentPropertyReferences: value });
}

/** Bind `layerId` (a layer of a main) to property `key` for `target`, or unbind with no key. */
export function planBindLayer(
	reader: DocumentReader,
	layerId: NodeId,
	target: ComponentPropertyTarget,
	key: string | undefined
): Change[] {
	return bindingChanges(reader, layerId, target, key);
}

export function planAddProperty(
	reader: DocumentReader,
	mainId: NodeId,
	spec: NewProperty
): PropertyPlan {
	const holder = definitionHolder(reader, mainId);
	const definitions = holderDefinitions(holder);
	const key = uniqueKey({ ...definitionsOf(reader, mainId) }, spec.name);
	const definition: ComponentPropertyDefinition = {
		type: spec.type,
		defaultValue: spec.defaultValue
	};
	const changes = planSetProps(reader, holder.id, {
		componentPropertyDefinitions: { ...definitions, [key]: definition }
	});
	const value: ComponentPropertyValue = { type: spec.type, value: spec.defaultValue };
	for (const instance of instancesOfFamily(reader, mainId)) {
		if (instance.type !== 'INSTANCE') continue;
		changes.push(
			...planSetProps(reader, instance.id, {
				componentProperties: { ...instance.componentProperties, [key]: value }
			})
		);
	}
	const target = TARGET_OF_TYPE[spec.type];
	if (target !== undefined) {
		for (const layerId of spec.layerIds ?? []) {
			changes.push(...bindingChanges(reader, layerId, target, key));
			const layer = reader.requireNode(layerId);
			changes.push(
				...planSetProps(reader, layerId, layerPropsFor(layer, target, spec.defaultValue))
			);
		}
	}
	return { key, changes };
}

export function planDeleteProperty(reader: DocumentReader, mainId: NodeId, key: string): Change[] {
	const holder = definitionHolder(reader, mainId);
	const { [key]: _removed, ...rest } = holderDefinitions(holder);
	const changes = planSetProps(reader, holder.id, { componentPropertyDefinitions: rest });
	for (const layer of familyLayers(reader, mainId)) {
		const references = layer.componentPropertyReferences;
		if (references === undefined) continue;
		for (const [target, bound] of referenceEntries(references)) {
			if (bound === key) changes.push(...bindingChanges(reader, layer.id, target, undefined));
		}
	}
	for (const instance of instancesOfFamily(reader, mainId)) {
		if (instance.type !== 'INSTANCE' || !Object.hasOwn(instance.componentProperties, key)) continue;
		const { [key]: _value, ...values } = instance.componentProperties;
		changes.push(...planSetProps(reader, instance.id, { componentProperties: values }));
	}
	return changes;
}

function renamedRecord<Value>(
	record: Record<string, Value>,
	from: string,
	to: string
): Record<string, Value> {
	const renamed: Record<string, Value> = {};
	for (const [key, value] of Object.entries(record)) renamed[key === from ? to : key] = value;
	return renamed;
}

export function planRenameProperty(
	reader: DocumentReader,
	mainId: NodeId,
	key: string,
	name: string
): PropertyPlan {
	const holder = definitionHolder(reader, mainId);
	const definitions = holderDefinitions(holder);
	if (name.trim() === key) return { key, changes: [] };
	if (!Object.hasOwn(definitions, key)) throw new Error(`no property ${key}`);
	const next = uniqueKey(definitionsOf(reader, mainId), name);
	const changes = planSetProps(reader, holder.id, {
		componentPropertyDefinitions: renamedRecord(definitions, key, next)
	});
	for (const layer of familyLayers(reader, mainId)) {
		const references = layer.componentPropertyReferences;
		if (references === undefined) continue;
		const renamed = Object.fromEntries(
			Object.entries(references).map(([target, bound]) => [target, bound === key ? next : bound])
		);
		changes.push(...planSetProps(reader, layer.id, { componentPropertyReferences: renamed }));
	}
	for (const instance of instancesOfFamily(reader, mainId)) {
		if (instance.type !== 'INSTANCE' || !Object.hasOwn(instance.componentProperties, key)) continue;
		changes.push(
			...planSetProps(reader, instance.id, {
				componentProperties: renamedRecord(instance.componentProperties, key, next)
			})
		);
	}
	return { key: next, changes };
}

/** New default of a property: the bound layers of every main in the family show it. */
export function planSetPropertyDefault(
	reader: DocumentReader,
	mainId: NodeId,
	key: string,
	value: boolean | string,
	idGenerator?: IdGenerator
): Change[] {
	const holder = definitionHolder(reader, mainId);
	const definitions = holderDefinitions(holder);
	const definition = definitions[key];
	if (definition === undefined) throw new Error(`no property ${key}`);
	const changes = planSetProps(reader, holder.id, {
		componentPropertyDefinitions: { ...definitions, [key]: { ...definition, defaultValue: value } }
	});
	const target = TARGET_OF_TYPE[definition.type];
	if (target === undefined) return changes;
	for (const layer of familyLayers(reader, mainId)) {
		if (layer.componentPropertyReferences?.[target] !== key) continue;
		if (target === 'mainComponent') {
			if (layer.type === 'INSTANCE' && typeof value === 'string' && reader.hasNode(value)) {
				changes.push(...planSwap(reader, layer.id, value, idGenerator));
			}
			continue;
		}
		changes.push(...planSetProps(reader, layer.id, layerPropsFor(layer, target, value)));
	}
	return changes;
}

/** The value a bound layer currently has, for pre-filling the "create property" dialog. */
export function boundLayerValue(
	reader: DocumentReader,
	layerId: NodeId,
	type: ComponentPropertyType
): boolean | string | undefined {
	const target = TARGET_OF_TYPE[type];
	if (target === undefined) return undefined;
	return layerValueFor(reader.requireNode(layerId), target);
}

// ---------- instance values ----------

function valuesOfVariants(values: Record<string, ComponentPropertyValue>): Record<string, string> {
	const wanted: Record<string, string> = {};
	for (const [key, entry] of Object.entries(values)) {
		if (entry.type === 'VARIANT') wanted[key] = String(entry.value);
	}
	return wanted;
}

function changedKeys(
	now: Record<string, ComponentPropertyValue>,
	before: Record<string, ComponentPropertyValue> | undefined
): string[] {
	return Object.keys(now).filter((key) => before?.[key]?.value !== now[key].value);
}

function variantSwitch(
	reader: DocumentReader,
	instance: Node,
	changed: string[],
	idGenerator?: IdGenerator
): Change[] | undefined {
	if (instance.type !== 'INSTANCE') return undefined;
	const set = variantSetOf(reader, instance.mainComponentId);
	if (set === undefined) return undefined;
	const variantKey = changed.find((key) => instance.componentProperties[key]?.type === 'VARIANT');
	if (variantKey === undefined) return undefined;
	const target = findVariant(
		reader,
		set.id,
		valuesOfVariants(instance.componentProperties),
		variantKey
	);
	if (target === undefined || target.id === instance.mainComponentId) return [];
	return planSwap(reader, instance.id, target.id, idGenerator);
}

/**
 * What an instance must do after its `componentProperties` changed from `before`: a changed
 * variant property switches the instance to the matching variant; changed boolean, text and
 * instance-swap values update the layers bound to them.
 */
export function planInstancePropertyEffects(
	reader: DocumentReader,
	instance: Node,
	before: Record<string, ComponentPropertyValue> | undefined,
	idGenerator?: IdGenerator
): Change[] {
	if (instance.type !== 'INSTANCE') return [];
	const changed = changedKeys(instance.componentProperties, before);
	if (changed.length === 0) return [];
	const switched = variantSwitch(reader, instance, changed, idGenerator);
	if (switched !== undefined && switched.length > 0) return switched;

	const definitions = definitionsOf(reader, instance.mainComponentId);
	const changes: Change[] = [];
	for (const { layer, source } of boundLayers(reader, instance, instance.mainComponentId)) {
		const references = source.componentPropertyReferences;
		if (references === undefined) continue;
		for (const [target, key] of referenceEntries(references)) {
			if (!changed.includes(key) || definitions[key] === undefined) continue;
			changes.push(
				...layerChanges(reader, layer, target, instance.componentProperties[key].value, idGenerator)
			);
		}
	}
	return changes;
}

function layerChanges(
	reader: DocumentReader,
	layer: Node,
	target: ComponentPropertyTarget,
	value: boolean | string,
	idGenerator?: IdGenerator
): Change[] {
	if (target === 'mainComponent') {
		if (layer.type !== 'INSTANCE' || typeof value !== 'string' || !reader.hasNode(value)) return [];
		return planSwap(reader, layer.id, value, idGenerator);
	}
	const props = layerPropsFor(layer, target, value);
	if (Object.keys(props).length === 0) return [];
	props.touched = withTouchedGroup(layer, touchedGroupOfTarget(target));
	return planSetProps(reader, layer.id, props);
}
