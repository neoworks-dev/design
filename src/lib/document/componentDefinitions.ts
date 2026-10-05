// Reads of component property definitions and variants. A main component inside a component set
// takes the set's definitions (variant properties, shared boolean/text/swap properties) plus its
// own. Pure: no kernel, no Svelte.

import type { DocumentReader } from './store';
import type {
	ComponentNode,
	ComponentPropertyDefinition,
	ComponentPropertyValue,
	ComponentSetNode,
	NodeId
} from './types';

export function variantSetOf(reader: DocumentReader, mainId: NodeId): ComponentSetNode | undefined {
	const main = reader.getNode(mainId);
	if (!main || main.parentId === null) return undefined;
	const parent = reader.getNode(main.parentId);
	if (!parent || parent.type !== 'COMPONENT_SET') return undefined;
	return parent;
}

/** The variant components of a set, in layer order. */
export function variantsOf(reader: DocumentReader, setId: NodeId): ComponentNode[] {
	const variants: ComponentNode[] = [];
	for (const child of reader.childNodes(setId)) {
		if (child.type === 'COMPONENT') variants.push(child);
	}
	return variants;
}

/** Definitions an instance of `mainId` can be given values for. */
export function definitionsOf(
	reader: DocumentReader,
	mainId: NodeId
): Record<string, ComponentPropertyDefinition> {
	const main = reader.getNode(mainId);
	if (!main || main.type !== 'COMPONENT') return {};
	const set = variantSetOf(reader, mainId);
	if (set === undefined) return main.componentPropertyDefinitions;
	return { ...set.componentPropertyDefinitions, ...main.componentPropertyDefinitions };
}

/** The values a fresh instance of `mainId` starts with. */
export function defaultPropertyValues(
	reader: DocumentReader,
	mainId: NodeId
): Record<string, ComponentPropertyValue> {
	const main = reader.getNode(mainId);
	const values: Record<string, ComponentPropertyValue> = {};
	for (const [key, definition] of Object.entries(definitionsOf(reader, mainId))) {
		values[key] = { type: definition.type, value: definition.defaultValue };
		if (definition.type !== 'VARIANT' || main?.type !== 'COMPONENT') continue;
		const own = main.variantProperties?.[key];
		if (own !== undefined) values[key] = { type: 'VARIANT', value: own };
	}
	return values;
}

/**
 * The variant that best matches `wanted`: the one agreeing on most properties, preferring
 * `keep` (the property the user just changed) over the others.
 */
export function findVariant(
	reader: DocumentReader,
	setId: NodeId,
	wanted: Record<string, string>,
	keep?: string
): ComponentNode | undefined {
	let best: ComponentNode | undefined;
	let bestScore = -1;
	for (const variant of variantsOf(reader, setId)) {
		const score = variantScore(variant, wanted, keep);
		if (score > bestScore) {
			best = variant;
			bestScore = score;
		}
	}
	return best;
}

function variantScore(
	variant: ComponentNode,
	wanted: Record<string, string>,
	keep: string | undefined
): number {
	let score = 0;
	for (const [key, value] of Object.entries(wanted)) {
		if (variant.variantProperties?.[key] !== value) continue;
		score += key === keep ? 1000 : 1;
	}
	return score;
}

/** `Size=Large, State=Hover`: the layer name Figma gives a variant. */
export function variantName(properties: Record<string, string>): string {
	return Object.entries(properties)
		.map(([key, value]) => `${key}=${value}`)
		.join(', ');
}
