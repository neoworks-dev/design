// The `spatial` service: cached absolute bounds and the spatial index over the current document
// (#40), queried by point and rect. The pure parts live in lib/document/sceneIndex.ts; this wraps
// them for the kernel: it follows `document/change` and `document/replace`, and defaults the page
// to the current one.

import { Service, type Context } from '@neoworks/extension-system';
import {
	SceneIndex,
	type BoundsKind,
	type DocumentChangeEvent,
	type DocumentReader,
	type NodeId,
	type Rect
} from '../document';
import type { DocumentService } from './document';

declare module '@neoworks/extension-system' {
	interface Context {
		spatial: SpatialService;
	}
}

export class SpatialService extends Service {
	private index: SceneIndex | undefined;
	private indexedStore: DocumentReader | undefined;

	/**
	 * `document` is captured at construction (from the providing plugin's ctx, which injects it)
	 * so consumers need not inject it themselves.
	 */
	constructor(
		ctx: Context,
		private readonly document: DocumentService
	) {
		super(ctx, 'spatial');
	}

	/** The index of the live store; a replaced document gets a fresh one. */
	get sceneIndex(): SceneIndex {
		const store = this.document.reader;
		if (this.index && this.indexedStore === store) return this.index;
		this.index = new SceneIndex(store);
		this.indexedStore = store;
		return this.index;
	}

	absoluteBounds(id: NodeId): Rect {
		return this.sceneIndex.absoluteBounds(id);
	}

	renderBounds(id: NodeId): Rect {
		return this.sceneIndex.renderBounds(id);
	}

	atPoint(
		point: { x: number; y: number },
		tolerance = 0,
		kind: BoundsKind = 'render',
		pageId: NodeId = this.document.currentPageId
	): NodeId[] {
		return this.sceneIndex.atPoint(pageId, point, tolerance, kind);
	}

	inRect(
		rect: Rect,
		options: { kind?: BoundsKind; contained?: boolean } = {},
		pageId: NodeId = this.document.currentPageId
	): NodeId[] {
		return this.sceneIndex.inRect(pageId, rect, options);
	}

	/** Nodes a viewport showing `viewportRect` has to draw. */
	visible(viewportRect: Rect, pageId: NodeId = this.document.currentPageId): NodeId[] {
		return this.sceneIndex.visible(pageId, viewportRect);
	}

	handleDocumentChange(event: DocumentChangeEvent): void {
		if (!this.index) return;
		this.index.handleChange(event);
	}

	handleDocumentReplace(): void {
		this.index = undefined;
		this.indexedStore = undefined;
	}
}
