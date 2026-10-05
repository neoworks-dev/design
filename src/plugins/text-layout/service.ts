import { Service, type Context } from '@neoworks/extension-system';
import type { Change, NodeId, TextNode } from '../../lib/document';
import type { TextPosition, TextRange } from '../../lib/document/text';
import type { FontRef } from '../../lib/fonts/resolve';
import {
	type LineBounds,
	type Rect,
	type TextLayoutEngine,
	type TextMeasure
} from '../../lib/text/layoutEngine';
import type { NodeTextLayout } from '../../lib/text/layoutEngine';

declare module '@neoworks/extension-system' {
	interface Context {
		textLayout: TextLayoutService;
	}
}

/** Properties whose change can change the size of an auto-sized text. */
const LAYOUT_PROPERTIES = [
	'paragraphs',
	'defaultStyle',
	'textAutoResize',
	'textTruncation',
	'maxLines',
	'leadingTrim'
];
const SIZE_TOLERANCE = 0.01;

/**
 * Text layout for the rest of the app: sizes, caret and selection rectangles, hit testing and the
 * size an auto-resizing text box must have. It wraps the `TextLayoutEngine` (Skia Paragraph) and
 * reads nodes through the variable resolver, so bound styles lay out like they draw.
 */
export class TextLayoutService extends Service {
	private readonly loading = new Set<string>();

	constructor(
		ctx: Context,
		readonly engine: TextLayoutEngine,
		private readonly resolveNode: (id: NodeId) => TextNode | undefined,
		private readonly loadFont: (ref: FontRef) => Promise<unknown>
	) {
		super(ctx, 'textLayout');
	}

	layout(nodeId: NodeId): NodeTextLayout {
		return this.layoutOf(this.requireNode(nodeId));
	}

	/** Layout of a node value (the draw hook passes the already resolved node). */
	layoutOf(node: TextNode): NodeTextLayout {
		const layout = this.engine.layout(node);
		this.loadPendingFaces(layout);
		return layout;
	}

	measure(nodeId: NodeId): TextMeasure {
		const layout = this.layout(nodeId);
		return { width: layout.width, height: layout.height, lineCount: layout.lineCount };
	}

	caretRect(nodeId: NodeId, position: TextPosition): Rect {
		return this.engine.caretRect(this.requireLaidOut(nodeId), position);
	}

	rangeRects(nodeId: NodeId, from: TextPosition, to: TextPosition): Rect[] {
		return this.engine.rangeRects(this.requireLaidOut(nodeId), { start: from, end: to });
	}

	rangeRectsOf(nodeId: NodeId, range: TextRange): Rect[] {
		return this.engine.rangeRects(this.requireLaidOut(nodeId), range);
	}

	offsetAtPoint(nodeId: NodeId, point: { x: number; y: number }): TextPosition {
		return this.engine.offsetAtPoint(this.requireLaidOut(nodeId), point);
	}

	lineBounds(nodeId: NodeId, position: TextPosition): LineBounds {
		return this.engine.lineBounds(this.requireLaidOut(nodeId), position);
	}

	wordBoundary(nodeId: NodeId, position: TextPosition): { start: number; end: number } {
		return this.engine.wordBoundary(this.requireLaidOut(nodeId), position);
	}

	lineCount(nodeId: NodeId, paragraph: number): number {
		return this.engine.lineCount(this.requireLaidOut(nodeId), paragraph);
	}

	/** Fonts the document references that are not installed (drawn with a substitute). */
	missingFonts(nodeId: NodeId): FontRef[] {
		return this.layout(nodeId).missingFonts;
	}

	/**
	 * The `set` that gives an auto-resizing text node the size its text needs; empty when it has
	 * that size already or its size is fixed.
	 */
	fitChanges(nodeId: NodeId): Change[] {
		const node = this.resolveNode(nodeId);
		if (!node || node.textAutoResize === 'NONE') return [];
		const measure = this.engine.measure(node);
		const props: Record<string, unknown> = {};
		if (node.textAutoResize === 'WIDTH_AND_HEIGHT' && differs(node.width, measure.width)) {
			props.width = measure.width;
		}
		if (differs(node.height, measure.height)) props.height = measure.height;
		if (Object.keys(props).length === 0) return [];
		return this.ctx.document.setProps(nodeId, props);
	}

	/** Changes that refit every text node touched by `changes` (the `document/append` step). */
	fitChangesFor(changes: Change[]): Change[] {
		const derived: Change[] = [];
		for (const id of this.textNodesTouchedBy(changes)) derived.push(...this.fitChanges(id));
		return derived;
	}

	snapshotState(): unknown {
		return { cachedNodes: this.engine.cachedNodeCount };
	}

	private textNodesTouchedBy(changes: Change[]): Set<NodeId> {
		const ids = new Set<NodeId>();
		for (const change of changes) {
			if (change.t === 'add' && change.node.type === 'TEXT') ids.add(change.node.id);
			if (change.t !== 'set') continue;
			const node = this.ctx.document.get(change.id);
			if (!node || node.type !== 'TEXT') continue;
			if (touchesLayout(node, change.set)) ids.add(change.id);
		}
		return ids;
	}

	private requireNode(nodeId: NodeId): TextNode {
		const node = this.resolveNode(nodeId);
		if (!node) throw new Error(`not a text node: ${nodeId}`);
		return node;
	}

	private requireLaidOut(nodeId: NodeId): TextNode {
		const node = this.requireNode(nodeId);
		this.layoutOf(node);
		return node;
	}

	private loadPendingFaces(layout: NodeTextLayout): void {
		for (const face of layout.pendingFaces) {
			const key = `${face.family}/${face.style}`;
			if (this.loading.has(key)) continue;
			this.loading.add(key);
			void this.loadFont(face)
				.catch((error: unknown) => this.ctx.logger.warn(`loading font ${key} failed`, error))
				.finally(() => this.loading.delete(key));
		}
	}
}

function differs(left: number, right: number): boolean {
	return Math.abs(left - right) > SIZE_TOLERANCE;
}

function touchesLayout(node: TextNode, set: Record<string, unknown>): boolean {
	if (LAYOUT_PROPERTIES.some((key) => key in set)) return true;
	return node.textAutoResize === 'HEIGHT' && 'width' in set;
}
