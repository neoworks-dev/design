// Copy and paste properties (Ctrl+Alt+C / Ctrl+Alt+V): the appearance of one layer onto others.
// Appearance is fills, strokes, effects, opacity, corner radius and the text style, plus the
// styles those came from. A target only takes the properties it has: a rectangle gets no text
// style, a group gets no fills. Pure: planners return changes.

import {
	planSetProps,
	type Change,
	type DocumentReader,
	type NodeId,
	type TextStyle
} from '../document';
import { copyableIds } from './clipboardPayload';

/** Property names copied as they are, when the source and target both carry them. */
const COPIED_KEYS = [
	'fills',
	'strokes',
	'effects',
	'opacity',
	'cornerRadius',
	'cornerSmoothing',
	'fillStyleId',
	'strokeStyleId',
	'effectStyleId'
] as const;

export interface CopiedProperties {
	/** Raw node properties by name. */
	values: Record<string, unknown>;
	/** The default text style of a copied text node. */
	textStyle?: TextStyle;
}

/** The appearance of the first selected layer; `null` when nothing can be copied. */
export function copyProperties(
	reader: DocumentReader,
	ids: readonly NodeId[]
): CopiedProperties | null {
	const [sourceId] = copyableIds(reader, ids);
	if (sourceId === undefined) return null;
	const source = reader.requireNode(sourceId);
	const values: Record<string, unknown> = {};
	for (const key of COPIED_KEYS) {
		if (key in source) values[key] = structuredClone(Reflect.get(source, key));
	}
	if (source.type === 'TEXT') return { values, textStyle: structuredClone(source.defaultStyle) };
	return { values };
}

function propertiesFor(node: object, copied: CopiedProperties): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(copied.values)) {
		if (key in node) props[key] = structuredClone(value);
	}
	return props;
}

/** Apply the copied appearance to every selected layer in one change list. */
export function planPasteProperties(
	reader: DocumentReader,
	ids: readonly NodeId[],
	copied: CopiedProperties
): Change[] {
	const changes: Change[] = [];
	for (const id of copyableIds(reader, ids)) {
		const node = reader.requireNode(id);
		const props = propertiesFor(node, copied);
		if (node.type === 'TEXT' && copied.textStyle !== undefined) {
			props.defaultStyle = { ...node.defaultStyle, ...structuredClone(copied.textStyle) };
		}
		changes.push(...planSetProps(reader, id, props));
	}
	return changes;
}
