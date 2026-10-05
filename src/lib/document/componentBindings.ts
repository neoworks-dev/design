// Layers bound to component properties. A layer of a main component names, in
// `componentPropertyReferences`, the property that drives its visibility, text or nested
// instance. When an instance's property value changes, the bound layers of that instance follow;
// the layer edit counts as an override (it marks the layer's group touched) so a later change to
// the main does not undo it.

import { touchedOf } from './componentGroups';
import { emptyParagraph, plainText } from './text';
import { nodeInMain } from './components';
import type { DocumentReader } from './store';
import type {
	ComponentPropertyTarget,
	ComponentPropertyType,
	ComponentPropertyValue,
	Node,
	NodeId,
	Paragraph,
	TextStyle,
	TouchedGroup
} from './types';

/** What a property type can drive. */
export const TARGET_OF_TYPE: Record<ComponentPropertyType, ComponentPropertyTarget | undefined> = {
	BOOLEAN: 'visible',
	TEXT: 'characters',
	INSTANCE_SWAP: 'mainComponent',
	VARIANT: undefined,
	SLOT: undefined
};

const GROUP_OF_TARGET: Record<ComponentPropertyTarget, TouchedGroup | undefined> = {
	visible: 'visibility',
	characters: 'text-content',
	mainComponent: undefined
};

const TARGETS: ComponentPropertyTarget[] = ['visible', 'characters', 'mainComponent'];

/** The bindings of a layer as [target, property key] pairs. */
export function referenceEntries(
	references: Partial<Record<ComponentPropertyTarget, string>>
): [ComponentPropertyTarget, string][] {
	const entries: [ComponentPropertyTarget, string][] = [];
	for (const target of TARGETS) {
		const key = references[target];
		if (key !== undefined) entries.push([target, key]);
	}
	return entries;
}

export function textToParagraphs(template: Paragraph[], text: string): Paragraph[] {
	const first = template[0];
	let firstStyle: Partial<TextStyle> = {};
	if (first !== undefined && first.runs.length > 0) firstStyle = first.runs[0].style;
	return text.split('\n').map((line) => {
		const paragraph = emptyParagraph(first);
		if (line === '') return paragraph;
		return { ...paragraph, runs: [{ text: line, style: structuredClone(firstStyle) }] };
	});
}

/** The properties that make `layer` show `value` for `target`; empty when it already does. */
export function layerPropsFor(
	layer: Node,
	target: ComponentPropertyTarget,
	value: boolean | string
): Record<string, unknown> {
	if (target === 'visible' && 'visible' in layer && typeof value === 'boolean') {
		if (layer.visible === value) return {};
		return { visible: value };
	}
	if (target === 'characters' && layer.type === 'TEXT' && typeof value === 'string') {
		if (plainText(layer.paragraphs) === value) return {};
		return { paragraphs: textToParagraphs(layer.paragraphs, value) };
	}
	return {};
}

/** Value of `layer` for `target`, as a property default would be. */
export function layerValueFor(
	layer: Node,
	target: ComponentPropertyTarget
): boolean | string | undefined {
	if (target === 'visible' && 'visible' in layer) return layer.visible;
	if (target === 'characters' && layer.type === 'TEXT') return plainText(layer.paragraphs);
	if (target === 'mainComponent' && layer.type === 'INSTANCE') return layer.mainComponentId;
	return undefined;
}

export function withTouchedGroup(layer: Node, group: TouchedGroup | undefined): TouchedGroup[] {
	const current = touchedOf(layer);
	if (group === undefined || current.includes(group)) return [...current];
	return [...current, group];
}

export function touchedGroupOfTarget(target: ComponentPropertyTarget): TouchedGroup | undefined {
	return GROUP_OF_TARGET[target];
}

export interface BoundLayer {
	layer: Node;
	/** Where the bindings are written: the layer's counterpart in the main component. */
	source: Node;
}

/**
 * The layers of `instance` that carry property bindings, with the main-component layer holding
 * them. Nested instances are not entered: their layers belong to the nested instance's own
 * properties.
 */
export function boundLayers(reader: DocumentReader, instance: Node, mainId: NodeId): BoundLayer[] {
	const found: BoundLayer[] = [];
	const pending = [...reader.childNodes(instance.id)];
	while (pending.length > 0) {
		const layer = pending.shift();
		if (layer === undefined) break;
		const source = nodeInMain(reader, layer, mainId);
		if (source !== undefined && source.componentPropertyReferences !== undefined) {
			found.push({ layer, source });
		}
		if (layer.type !== 'INSTANCE') pending.push(...reader.childNodes(layer.id));
	}
	return found;
}

/**
 * Apply `values` to freshly cloned instance layers (not in the store yet), so a swapped instance
 * shows the property values it carried over. Layers are edited in place.
 */
export function bindFreshLayers(
	reader: DocumentReader,
	freshLayers: Node[],
	values: Record<string, ComponentPropertyValue>
): void {
	for (const layer of freshLayers) {
		if (layer.componentRef === undefined) continue;
		const source = reader.getNode(layer.componentRef);
		const references = source?.componentPropertyReferences;
		if (references === undefined) continue;
		for (const [target, key] of referenceEntries(references)) {
			const value = values[key];
			if (value === undefined) continue;
			const props = layerPropsFor(layer, target, value.value);
			if (Object.keys(props).length === 0) continue;
			Object.assign(layer, props);
			layer.touched = withTouchedGroup(layer, GROUP_OF_TARGET[target]);
		}
	}
}
