// Ready-for-development status of top-level frames and sections. Stored in the node's own
// `pluginData` under this plugin's id, so it saves with the file and needs no schema field.

import type { Change, DocumentReader, Node } from '../../lib/document';
import { planSetProps } from '../../lib/document';

export const PLUGIN_ID = 'inspect-panel';
const KEY = 'readyForDev';

export function isReadyForDev(node: Node): boolean {
	return node.pluginData[PLUGIN_ID]?.[KEY] === 'true';
}

/** Only frames and sections placed directly on a page can be marked. */
export function canMarkReady(reader: DocumentReader, node: Node): boolean {
	if (node.type !== 'FRAME' && node.type !== 'SECTION') return false;
	if (node.parentId === null) return false;
	return reader.requireNode(node.parentId).type === 'PAGE';
}

export function planReadyForDev(reader: DocumentReader, node: Node, ready: boolean): Change[] {
	const own = { ...node.pluginData[PLUGIN_ID] };
	if (ready) own[KEY] = 'true';
	else delete own[KEY];
	const pluginData = { ...node.pluginData, [PLUGIN_ID]: own };
	return planSetProps(reader, node.id, { pluginData });
}
