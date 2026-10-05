// Which resizing options make sense for a node: these rules decide what the panel lets the user
// pick; the `autolayout` plugin does the layout.

import type { DocumentReader, Node } from '../../lib/document';

export type Axis = 'horizontal' | 'vertical';
export type LimitProperty = 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight';

export function isAutoLayoutFrame(node: Node): boolean {
	if (!('layoutMode' in node)) return false;
	return node.layoutMode !== 'NONE';
}

function parentOf(reader: DocumentReader, node: Node): Node | undefined {
	if (node.parentId === null) return undefined;
	return reader.getNode(node.parentId);
}

/** The parent is an auto layout frame, so the node is placed and sized by it. */
export function isLayoutChild(reader: DocumentReader, node: Node): boolean {
	const parent = parentOf(reader, node);
	if (parent === undefined) return false;
	return isAutoLayoutFrame(parent);
}

/** Hug contents: auto layout frames and text. */
export function hugAllowed(node: Node): boolean {
	return node.type === 'TEXT' || isAutoLayoutFrame(node);
}

/** Fill container: children of an auto layout frame. */
export function fillAllowed(reader: DocumentReader, node: Node): boolean {
	return isLayoutChild(reader, node);
}

/** Constraints apply to children of a frame that does not lay them out itself. */
export function isConstrainable(reader: DocumentReader, node: Node): boolean {
	if (!('constraints' in node)) return false;
	const parent = parentOf(reader, node);
	if (parent === undefined || parent.type === 'PAGE') return false;
	if (!('layoutMode' in parent)) return false;
	return parent.layoutMode === 'NONE';
}

const CONSTRAINT_LABELS: Record<string, string> = {
	MIN: 'Left',
	MAX: 'Right',
	STRETCH: 'Left and right',
	CENTER: 'Center',
	SCALE: 'Scale'
};

const VERTICAL_LABELS: Record<string, string> = {
	MIN: 'Top',
	MAX: 'Bottom',
	STRETCH: 'Top and bottom',
	CENTER: 'Center',
	SCALE: 'Scale'
};

function options(labels: Record<string, string>): Array<{ value: string; label: string }> {
	return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const CONSTRAINT_OPTIONS: Record<Axis, Array<{ value: string; label: string }>> = {
	horizontal: options(CONSTRAINT_LABELS),
	vertical: options(VERTICAL_LABELS)
};
