// An imported SVG in clipboard payload form (#106), so pasting and dropping reuse the paste
// planner: it positions the nodes (viewport centre, paste here, inside the selected frame), gives
// them fresh ids and inserts them in one change set.

import { CLIPBOARD_FORMAT, type ClipboardPayload } from '../editing/clipboardPayload';
import type { NodeId } from '../document/types';
import { identityMatrix } from '../document/matrix';
import type { SvgImport } from './importSvg';

export function svgPayload(
	imported: SvgImport,
	documentId: string,
	pageId: NodeId
): ClipboardPayload {
	return {
		format: CLIPBOARD_FORMAT,
		version: 1,
		documentId,
		pageId,
		nodes: imported.nodes,
		roots: [{ id: imported.rootId, absoluteTransform: identityMatrix() }],
		bounds: { x: 0, y: 0, width: imported.width, height: imported.height },
		parentOrigin: { x: 0, y: 0 },
		entities: { variables: [], collections: [], styles: [], assets: [] }
	};
}
