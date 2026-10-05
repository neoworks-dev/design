// The worker's copy of the current page. Figma's API is synchronous (`figma.currentPage.selection`,
// `rect.x = 10`, `figma.createRectangle()` hands back a node with an id), while everything a worker
// does to the host is an async call. The mirror bridges the two: reads come from a snapshot the
// host sent when the plugin started, writes change the copy at once and queue the same change for
// the host, which receives them batched (`flush`) as one `document.apply`.
//
// Known limit, documented in docs/plugins/figma-compat.md: edits the user makes while the plugin
// runs are not mirrored (only the selection is).

import { createNode, generateNodeId, type Node, type NodeType } from '../../../document';
import { translateProps } from '../../../ai/tools/translateProps';
import type { NodeOperation, PluginNode } from '../../api/types';
import {
	privateNamespace,
	readEntry,
	sharedNamespace,
	withEntry,
	withRelaunchData
} from '../../pluginData';
import { FigmaCompatError } from './table';

/** What the host sends at start: pages, the current page's nodes and the selection. */
export interface MirrorSnapshot {
	currentPageId: string;
	pages: PluginNode[];
	selection: string[];
	nodes: PluginNode[];
	zoom: number;
	documentName: string;
}

type Action =
	| { kind: 'op'; operation: NodeOperation }
	| { kind: 'selection'; ids: string[] }
	| { kind: 'call'; method: string; params: unknown };

export interface MirrorHost {
	apply(operations: NodeOperation[]): Promise<unknown>;
	call(method: string, params: unknown): Promise<unknown>;
	onError(error: unknown): void;
}

const MAX_OPERATIONS_PER_CALL = 1000;

export class DocumentMirror {
	private readonly nodes = new Map<string, Node>();
	private readonly childLists = new Map<string, string[]>();
	private actions: Action[] = [];
	private scheduled = false;
	private tail: Promise<void> = Promise.resolve();
	pages: string[] = [];
	currentPageId = '';
	selection: string[] = [];
	zoom = 1;
	documentName = '';
	/** Increases with every change; the plugin counts as idle when it stops moving. */
	activity = 0;

	constructor(private readonly host: MirrorHost) {}

	load(snapshot: MirrorSnapshot): void {
		this.nodes.clear();
		this.childLists.clear();
		this.currentPageId = snapshot.currentPageId;
		this.selection = [...snapshot.selection];
		this.zoom = snapshot.zoom;
		this.documentName = snapshot.documentName;
		this.pages = snapshot.pages.map((page) => page.id);
		const everything = [...snapshot.pages, ...snapshot.nodes];
		for (const node of everything) this.nodes.set(node.id, node);
		for (const node of everything) {
			if (node.parentId === null) continue;
			this.listOf(node.parentId).push(node.id);
		}
		for (const list of this.childLists.values()) {
			list.sort((left, right) => compareIndex(this.requireNode(left), this.requireNode(right)));
		}
	}

	// ---------- reads ----------

	has(id: string): boolean {
		return this.nodes.has(id);
	}

	node(id: string): Node | undefined {
		return this.nodes.get(id);
	}

	requireNode(id: string): Node {
		const node = this.nodes.get(id);
		if (node === undefined) throw new FigmaCompatError(`The node with id ${id} does not exist`);
		return node;
	}

	childIds(id: string): string[] {
		return [...this.listOf(id)];
	}

	/** `id` and everything below it, parents first. */
	subtree(id: string): string[] {
		const result = [id];
		for (const childId of this.listOf(id)) result.push(...this.subtree(childId));
		return result;
	}

	private listOf(id: string): string[] {
		let list = this.childLists.get(id);
		if (list === undefined) {
			list = [];
			this.childLists.set(id, list);
		}
		return list;
	}

	// ---------- writes ----------

	create(
		type: NodeType,
		parentId: string,
		props: Record<string, unknown>,
		position?: number
	): Node {
		this.requireNode(parentId);
		const siblings = this.listOf(parentId);
		let at = siblings.length;
		if (position !== undefined) at = Math.min(Math.max(position, 0), siblings.length);
		const id = generateNodeId();
		const blank = createNode(type, { id, parentId, index: 'a0' });
		const node = { ...blank, ...translateProps(props, blank) } as Node;
		this.nodes.set(id, node);
		siblings.splice(at, 0, id);
		this.queue({
			kind: 'op',
			operation: { op: 'create', type, id, parentId, position: at, props }
		});
		return node;
	}

	update(id: string, props: Record<string, unknown>): void {
		const node = this.requireNode(id);
		Object.assign(node, translateProps(props, node));
		this.queue({ kind: 'op', operation: { op: 'set', id, props } });
	}

	remove(id: string): void {
		const node = this.requireNode(id);
		if (node.type === 'PAGE') throw new FigmaCompatError('A page cannot be removed');
		const subtree = this.subtree(id);
		this.detach(id);
		for (const removed of subtree) {
			this.nodes.delete(removed);
			this.childLists.delete(removed);
		}
		this.selection = this.selection.filter((selected) => !subtree.includes(selected));
		this.queue({ kind: 'op', operation: { op: 'delete', id } });
	}

	move(id: string, parentId: string, position?: number): void {
		const node = this.requireNode(id);
		this.requireNode(parentId);
		if (this.subtree(id).includes(parentId)) {
			throw new FigmaCompatError('A node cannot be moved into itself');
		}
		this.detach(id);
		const siblings = this.listOf(parentId);
		let at = siblings.length;
		if (position !== undefined) at = Math.min(Math.max(position, 0), siblings.length);
		siblings.splice(at, 0, id);
		node.parentId = parentId;
		this.queue({ kind: 'op', operation: { op: 'move', id, parentId, position: at } });
	}

	private detach(id: string): void {
		const node = this.requireNode(id);
		if (node.parentId === null) return;
		const siblings = this.listOf(node.parentId);
		const position = siblings.indexOf(id);
		if (position >= 0) siblings.splice(position, 1);
	}

	setSelection(ids: string[]): void {
		this.selection = [...ids];
		this.queue({ kind: 'selection', ids: [...ids] });
	}

	/** The host reported a selection change (not queued back to it). */
	adoptSelection(ids: string[]): void {
		this.selection = ids.filter((id) => this.nodes.has(id));
	}

	// ---------- plugin data ----------

	readData(pluginId: string, id: string, key: string): string {
		return readEntry(this.requireNode(id).pluginData, privateNamespace(pluginId), key);
	}

	writeData(pluginId: string, id: string, key: string, value: string): void {
		const node = this.requireNode(id);
		node.pluginData = withEntry(node.pluginData, privateNamespace(pluginId), key, value);
		this.queue({ kind: 'call', method: 'storage.setData', params: { nodeId: id, key, value } });
	}

	readSharedData(id: string, namespace: string, key: string): string {
		return readEntry(this.requireNode(id).pluginData, sharedNamespace(namespace), key);
	}

	writeSharedData(id: string, namespace: string, key: string, value: string): void {
		const node = this.requireNode(id);
		node.pluginData = withEntry(node.pluginData, sharedNamespace(namespace), key, value);
		this.queue({
			kind: 'call',
			method: 'storage.setSharedData',
			params: { nodeId: id, namespace, key, value }
		});
	}

	writeRelaunchData(pluginId: string, id: string, data: Record<string, string>): void {
		const node = this.requireNode(id);
		node.pluginData = withRelaunchData(node.pluginData, pluginId, data);
		this.queue({ kind: 'call', method: 'storage.setRelaunchData', params: { nodeId: id, data } });
	}

	// ---------- flushing ----------

	private queue(action: Action): void {
		this.actions.push(action);
		this.activity += 1;
		if (this.scheduled) return;
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			void this.flush();
		});
	}

	/** Send what was queued. Flushes run one after another; resolves when this one is done. */
	flush(): Promise<void> {
		const actions = this.actions;
		this.actions = [];
		this.tail = this.tail.then(() => this.send(actions));
		return this.tail;
	}

	private async send(actions: Action[]): Promise<void> {
		let operations: NodeOperation[] = [];
		const sendOperations = async (): Promise<void> => {
			while (operations.length > 0) {
				const batch = operations.splice(0, MAX_OPERATIONS_PER_CALL);
				await this.host.apply(batch);
			}
		};
		try {
			for (const action of actions) {
				if (action.kind === 'op') {
					operations.push(action.operation);
					continue;
				}
				await sendOperations();
				operations = [];
				if (action.kind === 'selection') await this.host.call('selection.set', { ids: action.ids });
				else await this.host.call(action.method, action.params);
			}
			await sendOperations();
		} catch (error) {
			this.host.onError(error);
		}
	}
}

function compareIndex(left: Node, right: Node): number {
	if (left.index < right.index) return -1;
	if (left.index > right.index) return 1;
	return 0;
}
