// The `prototype` service: flows and interactions as document data. Every edit is a change set
// through `document.apply`, so adding, editing and removing interactions are undoable steps
// (lib/prototype/model.ts has the pure planning). The panel, the connection handles and AI tools
// all go through here.

import { Service, type Context } from '@neoworks/extension-system';
import type { Node, NodeId, Reaction } from '../document';
import {
	connectionsOnPage,
	flowsOf,
	isPrototypeScreen,
	newReaction,
	planAddFlow,
	planAddReaction,
	planConnect,
	planRemoveFlow,
	planRemoveReaction,
	planRenameFlow,
	planReplaceReaction,
	planSetSettings,
	readSettings,
	reactionsOf,
	screenOf,
	type Connection,
	type Flow,
	type PrototypeSettings
} from '../prototype/model';
import type { DocumentService } from './document';
import type { InteractionRef, PrototypeState } from './prototypeState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		prototyping: PrototypeService;
	}
}

export class PrototypeService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		readonly state: PrototypeState
	) {
		super(ctx, 'prototyping');
	}

	// ---------- reads (reactive) ----------

	reactions(nodeId: NodeId): readonly Reaction[] {
		const node = this.document.get(nodeId);
		if (node === undefined) return [];
		return reactionsOf(node);
	}

	flows(): Flow[] {
		return flowsOf(this.document.reader, this.document.currentPageId);
	}

	connections(): Connection[] {
		return connectionsOnPage(this.document.reader, this.document.currentPageId);
	}

	isScreen(nodeId: NodeId): boolean {
		return isPrototypeScreen(this.document.reader, nodeId);
	}

	screenOf(nodeId: NodeId): NodeId | undefined {
		return screenOf(this.document.reader, nodeId);
	}

	screens(): Node[] {
		return this.document
			.childNodes(this.document.currentPageId)
			.filter((node) => isPrototypeScreen(this.document.reader, node.id));
	}

	settings(): PrototypeSettings {
		return readSettings(this.document.currentPage);
	}

	// ---------- interactions ----------

	addInteraction(nodeId: NodeId): void {
		const index = this.reactions(nodeId).length;
		this.edit(planAddReaction(this.document.reader, nodeId, newReaction(null)), 'Add interaction');
		this.state.activeInteraction = { nodeId, index };
	}

	updateInteraction(nodeId: NodeId, index: number, reaction: Reaction): void {
		const changes = planReplaceReaction(this.document.reader, nodeId, index, reaction);
		this.edit(changes, 'Edit interaction');
	}

	removeInteraction(nodeId: NodeId, index: number): void {
		this.edit(planRemoveReaction(this.document.reader, nodeId, index), 'Remove interaction');
		this.state.activeInteraction = null;
		this.state.selectedConnection = null;
	}

	/** Connect `sourceId` to the screen `destinationId`: retarget its navigate interaction or add one. */
	connect(sourceId: NodeId, destinationId: NodeId): void {
		const changes = planConnect(this.document.reader, sourceId, destinationId);
		this.edit(changes, 'Connect interaction');
		const index = this.connectionIndexTo(sourceId, destinationId);
		if (index < 0) return;
		this.state.selectedConnection = { nodeId: sourceId, index };
		this.state.activeInteraction = { nodeId: sourceId, index };
	}

	private connectionIndexTo(sourceId: NodeId, destinationId: NodeId): number {
		return (
			this.connections().find(
				(connection) =>
					connection.sourceId === sourceId && connection.destinationId === destinationId
			)?.reactionIndex ?? -1
		);
	}

	selectConnection(ref: InteractionRef | null): void {
		this.state.selectedConnection = ref;
		this.state.activeInteraction = ref;
	}

	removeSelectedConnection(): boolean {
		const selected = this.state.selectedConnection;
		if (selected === null) return false;
		this.removeInteraction(selected.nodeId, selected.index);
		return true;
	}

	// ---------- flows and settings ----------

	addFlow(nodeId: NodeId): void {
		this.edit(planAddFlow(this.document.reader, this.document.currentPageId, nodeId), 'Add flow');
	}

	renameFlow(nodeId: NodeId, name: string): void {
		const changes = planRenameFlow(this.document.reader, this.document.currentPageId, nodeId, name);
		this.edit(changes, 'Rename flow');
	}

	removeFlow(nodeId: NodeId): void {
		this.edit(
			planRemoveFlow(this.document.reader, this.document.currentPageId, nodeId),
			'Remove flow'
		);
	}

	setDevice(device: string): void {
		const changes = planSetSettings(this.document.reader, this.document.currentPageId, { device });
		this.edit(changes, 'Set prototype device');
	}

	private edit(changes: Parameters<DocumentService['apply']>[0], label: string): void {
		if (changes.length === 0) return;
		this.document.apply(changes, { origin: 'user', label });
	}
}
