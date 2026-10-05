// Component sets and variants. A COMPONENT_SET holds COMPONENT children; each child's
// `variantProperties` gives a value for every variant property the set defines (a VARIANT
// definition on the set). Instances of a variant carry the same properties as VARIANT values, and
// changing one switches the instance to the matching variant (componentProperties.ts).

import { cloneSubtree } from './clone';
import { variantName, variantsOf } from './componentDefinitions';
import { planSetProps } from './changes';
import { createNode } from './defaults';
import { keyBetween, keysBetween } from './fractionalIndex';
import { generateNodeId, type IdGenerator } from './ids';
import { translationMatrix } from './matrix';
import type { DocumentReader } from './store';
import type {
	Change,
	ComponentNode,
	ComponentPropertyDefinition,
	ComponentSetNode,
	Node,
	NodeId,
	Stroke
} from './types';

export const VARIANT_PURPLE = { r: 0.592, g: 0.278, b: 1 };
const SET_PADDING = 24;
const VARIANT_GAP = 16;
const FIRST_PROPERTY = 'Property 1';

export interface VariantSetPlan {
	setId: NodeId;
	changes: Change[];
}

interface LocalBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

function localBounds(node: Node): LocalBounds {
	if (!('transform' in node)) throw new Error(`${node.id} has no geometry`);
	return {
		x: node.transform[0][2],
		y: node.transform[1][2],
		width: node.width,
		height: node.height
	};
}

function unionOf(boxes: LocalBounds[]): LocalBounds {
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.width));
	const bottom = Math.max(...boxes.map((box) => box.y + box.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function dashedPurple(): Stroke {
	return {
		paints: [
			{ type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: VARIANT_PURPLE }
		],
		weight: 1,
		align: 'INSIDE',
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: [6, 4]
	};
}

function uniqueValues(components: ComponentNode[]): string[] {
	const used = new Set<string>();
	return components.map((component) => {
		let value = component.name;
		let number = 2;
		while (used.has(value)) {
			value = `${component.name} ${number}`;
			number += 1;
		}
		used.add(value);
		return value;
	});
}

/** Combine components into a new component set; they keep their relative positions. */
export function planCreateVariantSet(
	reader: DocumentReader,
	componentIds: readonly NodeId[],
	idGenerator: IdGenerator = generateNodeId
): VariantSetPlan {
	const components: ComponentNode[] = [];
	for (const id of componentIds) {
		const node = reader.requireNode(id);
		if (node.type !== 'COMPONENT') throw new Error(`${id} is not a component`);
		components.push(node);
	}
	const [first] = components;
	if (first === undefined || first.parentId === null) throw new Error('nothing to combine');
	const siblings = components.filter((component) => component.parentId === first.parentId);
	const parent = reader.requireNode(first.parentId);
	if (parent.type === 'COMPONENT_SET') throw new Error('component is already a variant');

	const bounds = unionOf(siblings.map(localBounds));
	const setId = idGenerator();
	const values = uniqueValues(siblings);
	const set = createNode('COMPONENT_SET', {
		id: setId,
		name: first.name,
		parentId: first.parentId,
		index: indexAfter(reader, first),
		transform: translationMatrix(bounds.x - SET_PADDING, bounds.y - SET_PADDING),
		width: bounds.width + SET_PADDING * 2,
		height: bounds.height + SET_PADDING * 2,
		fills: [],
		strokes: [dashedPurple()],
		cornerRadius: 5,
		clipsContent: false,
		componentPropertyDefinitions: {
			[FIRST_PROPERTY]: { type: 'VARIANT', defaultValue: values[0], variantOptions: values }
		}
	});
	const changes: Change[] = [{ t: 'add', node: set }];
	const keys = keysBetween(null, null, siblings.length);
	siblings.forEach((component, position) => {
		const own = localBounds(component);
		const properties = { [FIRST_PROPERTY]: values[position] };
		changes.push({
			t: 'move',
			id: component.id,
			parent: setId,
			index: keys[position],
			prevParent: component.parentId,
			prevIndex: component.index
		});
		changes.push(
			...planSetProps(reader, component.id, {
				transform: translationMatrix(
					own.x - bounds.x + SET_PADDING,
					own.y - bounds.y + SET_PADDING
				),
				variantProperties: properties,
				name: variantName(properties)
			})
		);
		changes.push(...instanceValueChanges(reader, component.id, FIRST_PROPERTY, values[position]));
	});
	return { setId, changes };
}

function indexAfter(reader: DocumentReader, node: Node): string {
	const siblings = reader.childNodes(node.parentId);
	const position = siblings.findIndex((sibling) => sibling.id === node.id);
	const next = siblings[position + 1];
	return keyBetween(node.index, next === undefined ? null : next.index);
}

/** Root instances of one variant: they gain or change a VARIANT value. */
function instanceValueChanges(
	reader: DocumentReader,
	variantId: NodeId,
	key: string,
	value: string | undefined
): Change[] {
	const changes: Change[] = [];
	for (const node of Object.values(reader.nodes)) {
		if (node.type !== 'INSTANCE' || node.componentRef !== undefined) continue;
		if (node.mainComponentId !== variantId) continue;
		const values = { ...node.componentProperties };
		if (value === undefined) Reflect.deleteProperty(values, key);
		else values[key] = { type: 'VARIANT', value };
		changes.push(...planSetProps(reader, node.id, { componentProperties: values }));
	}
	return changes;
}

function requireSet(reader: DocumentReader, setId: NodeId): ComponentSetNode {
	const set = reader.requireNode(setId);
	if (set.type !== 'COMPONENT_SET') throw new Error(`${setId} is not a component set`);
	return set;
}

/** Names of the variant properties of a set, in definition order. */
export function variantPropertyNames(set: ComponentSetNode): string[] {
	return Object.entries(set.componentPropertyDefinitions)
		.filter(([, definition]) => definition.type === 'VARIANT')
		.map(([key]) => key);
}

/** The values a variant property takes across the set's variants, in layer order. */
export function variantValues(reader: DocumentReader, setId: NodeId, key: string): string[] {
	const values: string[] = [];
	for (const variant of variantsOf(reader, setId)) {
		const value = variant.variantProperties?.[key];
		if (value !== undefined && !values.includes(value)) values.push(value);
	}
	return values;
}

function withOption(
	definition: ComponentPropertyDefinition,
	value: string
): ComponentPropertyDefinition {
	const options = [...(definition.variantOptions ?? [])];
	if (options.includes(value)) return definition;
	return { ...definition, variantOptions: [...options, value] };
}

/** Add a variant: a copy of `sourceId` (default the last variant) below the others. */
export function planAddVariant(
	reader: DocumentReader,
	setId: NodeId,
	sourceId?: NodeId,
	idGenerator: IdGenerator = generateNodeId
): { variantId: NodeId; changes: Change[] } {
	const set = requireSet(reader, setId);
	const variants = variantsOf(reader, setId);
	const source = variants.find((variant) => variant.id === sourceId) ?? variants.at(-1);
	if (source === undefined) throw new Error('a component set needs a variant to copy');
	const [firstKey] = variantPropertyNames(set);
	const properties: Record<string, string> = { ...source.variantProperties };
	if (firstKey !== undefined) properties[firstKey] = nextValue(reader, setId, firstKey);
	const lowest = Math.max(...variants.map((variant) => localBounds(variant).y + variant.height));
	const clone = cloneSubtree(reader, source.id, {
		parentId: setId,
		index: keyBetween(variants.at(-1)?.index ?? null, null),
		idGenerator
	});
	const [root] = clone.nodes;
	if (root.type !== 'COMPONENT') throw new Error('copy of a variant is not a component');
	root.variantProperties = properties;
	root.name = variantName(properties);
	root.transform = translationMatrix(localBounds(source).x, lowest + VARIANT_GAP);
	const boxes = [...variants.map(localBounds), localBounds(root)];
	const changes: Change[] = [...clone.changes];
	if (firstKey !== undefined) {
		const definition = set.componentPropertyDefinitions[firstKey];
		changes.push(
			...planSetProps(reader, setId, {
				componentPropertyDefinitions: {
					...set.componentPropertyDefinitions,
					[firstKey]: withOption(definition, properties[firstKey])
				}
			})
		);
	}
	changes.push(...fitSetToBoxes(reader, set, boxes));
	return { variantId: clone.rootId, changes };
}

function fitSetToBoxes(
	reader: DocumentReader,
	set: ComponentSetNode,
	boxes: LocalBounds[]
): Change[] {
	const bounds = unionOf(boxes);
	const shiftX = bounds.x - SET_PADDING;
	const shiftY = bounds.y - SET_PADDING;
	const changes: Change[] = [];
	if (shiftX !== 0 || shiftY !== 0) {
		for (const variant of variantsOf(reader, set.id)) {
			const own = localBounds(variant);
			changes.push(
				...planSetProps(reader, variant.id, {
					transform: translationMatrix(own.x - shiftX, own.y - shiftY)
				})
			);
		}
	}
	const [[a, c, e], [b, d, f]] = set.transform;
	changes.push(
		...planSetProps(reader, set.id, {
			transform: [
				[a, c, e + shiftX],
				[b, d, f + shiftY]
			],
			width: bounds.width + SET_PADDING * 2,
			height: bounds.height + SET_PADDING * 2
		})
	);
	return changes;
}

function nextValue(reader: DocumentReader, setId: NodeId, key: string): string {
	const taken = new Set(variantValues(reader, setId, key));
	let number = taken.size + 1;
	while (taken.has(`Variant${number}`)) number += 1;
	return `Variant${number}`;
}

/** Give a variant a value for one of the set's variant properties. */
export function planSetVariantValue(
	reader: DocumentReader,
	variantId: NodeId,
	key: string,
	value: string
): Change[] {
	const variant = reader.requireNode(variantId);
	if (variant.type !== 'COMPONENT' || variant.parentId === null) throw new Error('not a variant');
	const set = requireSet(reader, variant.parentId);
	const definition = set.componentPropertyDefinitions[key];
	if (definition === undefined || definition.type !== 'VARIANT')
		throw new Error(`no variant property ${key}`);
	const properties = { ...variant.variantProperties, [key]: value };
	const changes = planSetProps(reader, variantId, {
		variantProperties: properties,
		name: variantName(properties)
	});
	changes.push(
		...planSetProps(reader, set.id, {
			componentPropertyDefinitions: {
				...set.componentPropertyDefinitions,
				[key]: withOption(definition, value)
			}
		})
	);
	changes.push(...instanceValueChanges(reader, variantId, key, value));
	return changes;
}

/** Add a variant property to a set; every variant starts with `defaultValue`. */
export function planAddVariantProperty(
	reader: DocumentReader,
	setId: NodeId,
	name: string,
	defaultValue = 'Default'
): { key: string; changes: Change[] } {
	const set = requireSet(reader, setId);
	const trimmed = name.trim();
	if (trimmed === '') throw new Error('a property needs a name');
	let key = trimmed;
	let number = 2;
	while (Object.hasOwn(set.componentPropertyDefinitions, key)) {
		key = `${trimmed} ${number}`;
		number += 1;
	}
	const changes = planSetProps(reader, setId, {
		componentPropertyDefinitions: {
			...set.componentPropertyDefinitions,
			[key]: { type: 'VARIANT', defaultValue, variantOptions: [defaultValue] }
		}
	});
	for (const variant of variantsOf(reader, setId)) {
		const properties = { ...variant.variantProperties, [key]: defaultValue };
		changes.push(
			...planSetProps(reader, variant.id, {
				variantProperties: properties,
				name: variantName(properties)
			})
		);
		changes.push(...instanceValueChanges(reader, variant.id, key, defaultValue));
	}
	return { key, changes };
}

function renamedEntries<Value>(
	record: Record<string, Value>,
	from: string,
	to: string | undefined
): Record<string, Value> {
	const result: Record<string, Value> = {};
	for (const [key, value] of Object.entries(record)) {
		if (key !== from) result[key] = value;
		else if (to !== undefined) result[to] = value;
	}
	return result;
}

/** Rename (`name` given) or delete (`name` undefined) a variant property across the set. */
export function planChangeVariantProperty(
	reader: DocumentReader,
	setId: NodeId,
	key: string,
	name: string | undefined
): Change[] {
	const set = requireSet(reader, setId);
	const target = name === undefined ? undefined : name.trim();
	if (target === '') throw new Error('a property needs a name');
	if (target === key) return [];
	if (target !== undefined && Object.hasOwn(set.componentPropertyDefinitions, target)) {
		throw new Error(`a property named ${target} exists`);
	}
	const changes = planSetProps(reader, setId, {
		componentPropertyDefinitions: renamedEntries(set.componentPropertyDefinitions, key, target)
	});
	for (const variant of variantsOf(reader, setId)) {
		const properties = renamedEntries({ ...variant.variantProperties }, key, target);
		changes.push(
			...planSetProps(reader, variant.id, {
				variantProperties: properties,
				name: variantName(properties)
			})
		);
		changes.push(...renamedInstanceValues(reader, variant.id, key, target));
	}
	return changes;
}

function renamedInstanceValues(
	reader: DocumentReader,
	variantId: NodeId,
	key: string,
	target: string | undefined
): Change[] {
	const changes: Change[] = [];
	for (const node of Object.values(reader.nodes)) {
		if (node.type !== 'INSTANCE' || node.componentRef !== undefined) continue;
		if (node.mainComponentId !== variantId) continue;
		changes.push(
			...planSetProps(reader, node.id, {
				componentProperties: renamedEntries(node.componentProperties, key, target)
			})
		);
	}
	return changes;
}
