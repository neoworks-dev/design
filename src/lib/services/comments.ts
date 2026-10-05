// The `comments` service: local notes pinned to the canvas. The notes live in the document (see
// lib/comments/model.ts), so every create, edit, resolve and delete is a `document.apply` and
// therefore one undo step; this service adds the draft being placed, the open editor, the pin
// geometry and the panel's search and filter.

import { Service, type Context } from '@neoworks/extension-system';
import { generateNodeId, type NodeId } from '../document';
import type { Rect } from '../document/types';
import {
	matchesComment,
	newComment,
	pinHit,
	pinPosition,
	readComments,
	withComment,
	withoutComment,
	type Comment,
	type CommentFilter,
	type PluginData,
	type Point
} from '../comments/model';
import type { CommentDraft, CommentsState, EditorTarget } from './commentsState.svelte';
import type { DocumentService } from './document';

declare module '@neoworks/extension-system' {
	interface Context {
		comments: CommentsService;
	}
}

/** The part of the `viewport` service comments use (the library may not import plugins). */
export interface CommentsViewport {
	worldToScreen(point: Point): Point;
	readonly size: { width: number; height: number };
	panBy(deltaX: number, deltaY: number): void;
}

/** The part of the `hitTest` service comments use. */
export interface CommentsHitTest {
	deepest(query: { point: Point; tolerance?: number }): NodeId | undefined;
}

/** A comment with what the panel and the overlay need: its page and its number on that page. */
export interface CommentView extends Comment {
	pageName: string;
	/** 1-based, oldest first, within its page. */
	number: number;
}

/** Radius of a pin's bubble, in screen pixels. */
export const PIN_RADIUS = 11;

export class CommentsService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly viewport: CommentsViewport,
		private readonly hitTest: CommentsHitTest,
		private readonly state: CommentsState
	) {
		super(ctx, 'comments');
	}

	// ---------- reads (reactive) ----------

	get visible(): boolean {
		return this.state.visible;
	}

	get query(): string {
		return this.state.query;
	}

	get filter(): CommentFilter {
		return this.state.filter;
	}

	get editor(): EditorTarget | null {
		return this.state.editor;
	}

	get draft(): CommentDraft | null {
		return this.state.draft;
	}

	/** Every comment of the document, page by page, oldest first within a page. */
	all(): CommentView[] {
		const views: CommentView[] = [];
		for (const page of this.document.pages()) {
			readComments(page.id, page.pluginData).forEach((comment, index) => {
				views.push({ ...comment, pageName: page.name, number: index + 1 });
			});
		}
		return views;
	}

	/** The comments the panel lists: matching the search text and the filter. */
	listed(): CommentView[] {
		return this.all().filter((comment) =>
			matchesComment(comment, this.state.query, this.state.filter)
		);
	}

	onCurrentPage(): CommentView[] {
		const pageId = this.document.currentPageId;
		return this.all().filter((comment) => comment.pageId === pageId);
	}

	find(id: string): CommentView | undefined {
		return this.all().find((comment) => comment.id === id);
	}

	/** Where the pin of `comment` is on its page now (it follows its node). */
	positionOf(comment: Comment): Point {
		return pinPosition(comment, (id) => this.boundsOf(id));
	}

	/** The pin's bubble centre in canvas pixels: the pin's point is the tip of its tail. */
	bubbleCentre(comment: Comment): Point {
		const tip = this.viewport.worldToScreen(this.positionOf(comment));
		return { x: tip.x, y: tip.y - PIN_RADIUS };
	}

	/** The pin of the current page under a canvas pixel. */
	pinAt(screen: Point): CommentView | undefined {
		const pins = this.onCurrentPage().map((comment) => ({
			comment,
			screen: this.bubbleCentre(comment)
		}));
		return pinHit(pins, screen, PIN_RADIUS)?.comment;
	}

	// ---------- showing ----------

	setVisible(visible: boolean): void {
		this.state.visible = visible;
		if (!visible) this.closeEditor();
	}

	toggleVisible(): void {
		this.setVisible(!this.state.visible);
	}

	setQuery(query: string): void {
		this.state.query = query;
	}

	setFilter(filter: CommentFilter): void {
		this.state.filter = filter;
	}

	// ---------- placing and editing ----------

	/** Start a note at a page point; nothing is stored until `post`. Pins to the node under it. */
	beginDraft(point: Point): void {
		let anchorId: NodeId | null = null;
		let anchorOrigin: Point | null = null;
		const hit = this.hitTest.deepest({ point, tolerance: 0 });
		const bounds = hit === undefined ? undefined : this.boundsOf(hit);
		if (hit !== undefined && bounds !== undefined) {
			anchorId = hit;
			anchorOrigin = { x: bounds.x, y: bounds.y };
		}
		this.state.visible = true;
		this.state.draft = { pageId: this.document.currentPageId, point, anchorId, anchorOrigin };
		this.state.editor = { kind: 'draft' };
	}

	/** Store the draft as a comment (one undo step) and keep it open. Empty notes are refused. */
	post(text: string): boolean {
		const draft = this.state.draft;
		const trimmed = text.trim();
		if (draft === null || trimmed === '') return false;
		const comment = newComment({
			id: generateNodeId(),
			pageId: draft.pageId,
			point: draft.point,
			anchorId: draft.anchorId,
			anchorOrigin: draft.anchorOrigin,
			text: trimmed,
			now: Date.now()
		});
		this.writePage(draft.pageId, (pluginData) => withComment(pluginData, comment), 'Add comment');
		this.state.draft = null;
		this.state.editor = { kind: 'comment', id: comment.id };
		return true;
	}

	/** Drop the draft without storing anything. */
	cancelDraft(): void {
		this.state.draft = null;
		if (this.state.editor?.kind === 'draft') this.state.editor = null;
	}

	openEditor(id: string): void {
		if (this.find(id) === undefined) return;
		this.state.draft = null;
		this.state.visible = true;
		this.state.editor = { kind: 'comment', id };
	}

	closeEditor(): void {
		this.state.editor = null;
		this.state.draft = null;
	}

	setText(id: string, text: string): boolean {
		const comment = this.find(id);
		const trimmed = text.trim();
		if (comment === undefined || trimmed === '') return false;
		if (comment.text === trimmed) return true;
		this.replace(comment, { text: trimmed }, 'Edit comment');
		return true;
	}

	setResolved(id: string, resolved: boolean): void {
		const comment = this.find(id);
		if (comment === undefined || comment.resolved === resolved) return;
		let label = 'Reopen comment';
		if (resolved) label = 'Resolve comment';
		this.replace(comment, { resolved }, label);
	}

	remove(id: string): void {
		const comment = this.find(id);
		if (comment === undefined) return;
		this.writePage(
			comment.pageId,
			(pluginData) => withoutComment(pluginData, id),
			'Delete comment'
		);
		const editor = this.state.editor;
		if (editor !== null && editor.kind === 'comment' && editor.id === id) this.state.editor = null;
	}

	/** Show the page of a comment, centre the canvas on its pin and open it. */
	jumpTo(id: string): void {
		const comment = this.find(id);
		if (comment === undefined) return;
		if (comment.pageId !== this.document.currentPageId)
			this.document.setCurrentPage(comment.pageId);
		const tip = this.viewport.worldToScreen(this.positionOf(comment));
		const size = this.viewport.size;
		this.viewport.panBy(size.width / 2 - tip.x, size.height / 2 - tip.y);
		this.openEditor(id);
	}

	snapshotState(): Record<string, unknown> {
		return {
			visible: this.state.visible,
			editor: this.state.editor !== null,
			draft: this.state.draft !== null
		};
	}

	// ---------- internals ----------

	private boundsOf(id: NodeId): Rect | undefined {
		if (!this.document.has(id)) return undefined;
		return this.document.absoluteBounds(id);
	}

	private replace(comment: Comment, changes: Partial<Comment>, label: string): void {
		const updated: Comment = { ...comment, ...changes, updatedAt: Date.now() };
		this.writePage(comment.pageId, (pluginData) => withComment(pluginData, updated), label);
	}

	private writePage(
		pageId: NodeId,
		edit: (pluginData: PluginData) => PluginData,
		label: string
	): void {
		const next = edit(this.pluginDataOf(pageId));
		this.document.apply(this.document.setProps(pageId, { pluginData: next }), {
			origin: 'user',
			label
		});
	}

	private pluginDataOf(pageId: NodeId): PluginData {
		return this.document.require(pageId).pluginData;
	}
}
