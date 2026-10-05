// Plugin writes: turn the plugin's operations (create / set / delete / move, Figma-like property
// names) into document changes and apply them through the ONE mutation path, `document.apply`,
// as `origin: 'plugin'`. All operations of a call apply as one transaction, so a failing one
// changes nothing. The property vocabulary is the one the AI tools use (`translateProps`).

import {
	createNode,
	generateNodeId,
	indexAtPosition,
	type ApplyMeta,
	type Change,
	type Node,
	type NodeId
} from '../../document';
import type { DocumentService } from '../../services/document';
import { translateProps } from '../../ai/tools/translateProps';
import type { ApplyResult, NodeOperation } from './types';

/** One plugin call may not carry more operations than this: a loop in a plugin, not an edit. */
export const MAX_OPERATIONS_PER_CALL = 1000;

export class PluginOperationError extends Error {
	constructor(position: number, operation: string, message: string) {
		super(`operation ${position + 1} (${operation}): ${message}`);
		this.name = 'PluginOperationError';
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function requireNode(document: DocumentService, id: NodeId): Node {
	const node = document.get(id);
	if (node === undefined) throw new Error(`node ${id} does not exist`);
	return node;
}

interface PlanState {
	refs: Map<string, NodeId>;
	result: ApplyResult;
}

function resolveId(state: PlanState, id: string): NodeId {
	const known = state.refs.get(id);
	if (known === undefined) return id;
	return known;
}

function planCreate(
	document: DocumentService,
	operation: Extract<NodeOperation, { op: 'create' }>,
	state: PlanState
): Change[] {
	let parentId = document.currentPageId;
	if (operation.parentId !== undefined) parentId = resolveId(state, operation.parentId);
	requireNode(document, parentId);
	let position = document.children(parentId).length;
	if (operation.position !== undefined) position = operation.position;
	const id = generateNodeId();
	const blank = createNode(operation.type, {
		id,
		parentId,
		index: indexAtPosition(document.reader, parentId, position)
	});
	const props: Record<string, unknown> = {};
	if (operation.props !== undefined) Object.assign(props, operation.props);
	const node = { ...blank, ...translateProps(props, blank) } as Node;
	if (operation.ref !== undefined) state.refs.set(operation.ref, id);
	state.result.created.push({ ref: operation.ref, id });
	return document.insertNode(node);
}

function planSet(
	document: DocumentService,
	operation: Extract<NodeOperation, { op: 'set' }>,
	state: PlanState
): Change[] {
	const id = resolveId(state, operation.id);
	const node = requireNode(document, id);
	const changes = document.setProps(id, translateProps(operation.props, node));
	if (changes.length > 0 && !state.result.changed.includes(id)) state.result.changed.push(id);
	return changes;
}

function planDelete(
	document: DocumentService,
	operation: Extract<NodeOperation, { op: 'delete' }>,
	state: PlanState
): Change[] {
	const id = resolveId(state, operation.id);
	const node = requireNode(document, id);
	if (node.type === 'PAGE') throw new Error(`${id} is a page and cannot be deleted`);
	state.result.deleted.push(id);
	return document.removeNode(id);
}

function planMove(
	document: DocumentService,
	operation: Extract<NodeOperation, { op: 'move' }>,
	state: PlanState
): Change[] {
	const id = resolveId(state, operation.id);
	const node = requireNode(document, id);
	if (node.type === 'PAGE') throw new Error(`${id} is a page and cannot be moved`);
	const parentId = resolveId(state, operation.parentId);
	requireNode(document, parentId);
	let position = document.children(parentId).length;
	if (operation.position !== undefined) position = operation.position;
	if (!state.result.changed.includes(id)) state.result.changed.push(id);
	return document.moveNode(id, parentId, position);
}

function plan(document: DocumentService, operation: NodeOperation, state: PlanState): Change[] {
	if (operation.op === 'create') return planCreate(document, operation, state);
	if (operation.op === 'set') return planSet(document, operation, state);
	if (operation.op === 'move') return planMove(document, operation, state);
	return planDelete(document, operation, state);
}

/**
 * Apply `operations` as one transaction tagged with `meta`. Throws a `PluginOperationError` naming
 * the failing operation; nothing is applied then.
 */
export function applyOperations(
	document: DocumentService,
	operations: readonly NodeOperation[],
	meta: ApplyMeta
): ApplyResult {
	if (operations.length > MAX_OPERATIONS_PER_CALL) {
		throw new Error(
			`too many operations: ${operations.length}, at most ${MAX_OPERATIONS_PER_CALL}`
		);
	}
	const state: PlanState = { refs: new Map(), result: { created: [], changed: [], deleted: [] } };
	document.transaction(meta, () => {
		operations.forEach((operation, position) => {
			try {
				document.apply(plan(document, operation, state), meta);
			} catch (error) {
				throw new PluginOperationError(position, operation.op, describeError(error));
			}
		});
	});
	return state.result;
}
