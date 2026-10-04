// A new empty document: no nodes except one page, so the canvas always has somewhere to draw.

import { createNode } from './defaults';
import { keyBetween } from './fractionalIndex';
import { generateNodeId } from './ids';
import { SCHEMA_VERSION, type DesignDocument } from './types';

export function createBlankDocument(name = 'Untitled'): DesignDocument {
	const pageId = generateNodeId();
	return {
		schemaVersion: SCHEMA_VERSION,
		id: generateNodeId(),
		name,
		nodes: {
			[pageId]: createNode('PAGE', {
				id: pageId,
				name: 'Page 1',
				parentId: null,
				index: keyBetween(null, null)
			})
		},
		styles: {},
		variableCollections: {},
		variables: {},
		assets: {},
		fonts: []
	};
}
