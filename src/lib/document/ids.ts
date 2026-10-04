// Node id generation. Ids are random (nanoid): the document is offline, so there is no need for
// client:counter style ids (data-model.md section 1).

import { nanoid } from 'nanoid';
import type { NodeId } from './types';

const NODE_ID_LENGTH = 12;

export function generateNodeId(): NodeId {
	return nanoid(NODE_ID_LENGTH);
}

/** Produces ids for a batch of new nodes; tests inject a deterministic one. */
export type IdGenerator = () => NodeId;

export function sequentialIdGenerator(prefix = 'id'): IdGenerator {
	let counter = 0;
	return () => {
		counter += 1;
		return `${prefix}${counter}`;
	};
}
