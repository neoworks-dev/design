import type { Context } from '@neoworks/extension-system';
import { isPositioned } from '../../lib/editing/selectionOps';
import type { NodeId } from '../../lib/document/types';

const LABELLED_TYPES: readonly string[] = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'];

/** Frames directly on the current page: the top-level scope roots that get a name label. */
export function topLevelFrameIds(ctx: Context): NodeId[] {
	return ctx.document
		.childNodes(ctx.document.currentPageId)
		.filter((node) => LABELLED_TYPES.includes(node.type))
		.filter(isPositioned)
		.filter((node) => node.visible)
		.map((node) => node.id);
}
