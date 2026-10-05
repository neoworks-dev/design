import { Service, type Context } from '@neoworks/extension-system';
import {
	deepEqual,
	invertMatrix,
	paragraphsChange,
	transformPoint,
	type DocumentChangeEvent,
	type NodeId,
	type Paragraph,
	type TextNode,
	type TextStyle
} from '../../lib/document';
import type { TextPosition } from '../../lib/document/text';
import {
	adoptFragment,
	clampSelection,
	collapsedAt,
	deleteBackward,
	deleteForward,
	documentEnd,
	documentStart,
	fragmentOf,
	insertParagraphBreak,
	isCollapsed,
	moveFocus,
	paragraphEnd,
	pasteFragment,
	replaceSelection,
	resolveFragment,
	selectAll,
	selectParagraphAt,
	selectWordAt,
	selectedText,
	selectionRange,
	stepGrapheme,
	stepWord,
	type DeleteUnit,
	type EditResult,
	type TextSelection
} from '../../lib/text/editing';
import type { Point } from '../../lib/tools/protocol';
import { TextEditState } from './state.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		textEdit: TextEditService;
	}
}

export interface StartOptions {
	/** World position of the click: the caret goes there. */
	point?: Point;
	/** Select all text (Enter on a selected text node). */
	selectAll?: boolean;
}

export type MoveUnit = 'character' | 'word' | 'line' | 'line-edge' | 'document';

export interface MoveRequest {
	unit: MoveUnit;
	direction: -1 | 1;
	/** Keep the anchor (Shift held). */
	extend?: boolean;
}

export type EditKind = 'type' | 'delete' | 'other';

export interface ClipboardPayload {
	text: string;
	rich: string;
}

export const RICH_TEXT_MIME = 'application/x-neoworks-design-text';

const LABELS: Record<EditKind, string> = {
	type: 'Type text',
	delete: 'Delete text',
	other: 'Edit text'
};

const HIT_SLACK_PX = 4;

/**
 * The text editing session: which text node is being edited, where the selection is, and every
 * operation on it. Each edit is a `set paragraphs` change through `document.apply`, so undo, the
 * `documentchange` event and AI audit work as for any other change. The text logic itself is pure
 * (lib/text/editing.ts); this service adds the document, the layout service (caret movement by
 * line, hit testing) and the keymap scope while editing.
 *
 * Typing and deleting carry a `mergeKey` that changes whenever the caret is moved or another kind
 * of edit happens, so history folds a run of keystrokes into one undo step and a pause or a click
 * starts a new one.
 */
export class TextEditService extends Service {
	private releaseSession: (() => unknown) | undefined;
	private releaseComposing: (() => unknown) | undefined;
	private segment = 0;
	private lastKind: EditKind | null = null;
	private stickyX: number | null = null;
	private applying = false;

	constructor(
		ctx: Context,
		readonly state: TextEditState
	) {
		super(ctx, 'textEdit');
	}

	// ---------- reads ----------

	get active(): boolean {
		return this.state.nodeId !== null;
	}

	get nodeId(): NodeId | null {
		return this.state.nodeId;
	}

	get selection(): TextSelection {
		return this.state.selection;
	}

	get isComposing(): boolean {
		return this.state.composition !== null;
	}

	/** The node being edited. Throws outside a session. */
	editedNode(): TextNode {
		const id = this.state.nodeId;
		if (id === null) throw new Error('no text is being edited');
		const node = this.ctx.document.get(id);
		if (!node || node.type !== 'TEXT') throw new Error(`text node ${id} is gone`);
		return node;
	}

	snapshotState(): unknown {
		return { editing: this.state.nodeId };
	}

	// ---------- session ----------

	/** Start editing `id`. Does nothing when it is not an editable text node. */
	start(id: NodeId, options: StartOptions = {}): void {
		const node = this.ctx.document.get(id);
		if (!node || node.type !== 'TEXT' || node.locked) return;
		if (this.state.nodeId !== null && this.state.nodeId !== id) this.stop('commit');
		if (this.state.nodeId === null) this.enter(id);
		this.ctx.selection.select([id]);
		this.state.selection = this.initialSelection(node, options);
		this.noteMovement();
	}

	stop(reason: 'commit' | 'escape' = 'commit'): void {
		const id = this.state.nodeId;
		if (id === null) return;
		this.endComposition(this.currentCompositionText());
		this.state.nodeId = null;
		this.state.typingStyle = null;
		this.state.composition = null;
		void this.releaseSession?.();
		this.releaseSession = undefined;
		this.ctx.emit('text-edit/stopped', id);
		if (reason === 'escape' && this.ctx.document.has(id)) this.ctx.selection.select([id]);
	}

	/** Keeps the selection valid after undo, redo or a foreign edit of the edited text. */
	handleDocumentChange(event: DocumentChangeEvent): void {
		const id = this.state.nodeId;
		if (id === null || this.applying) return;
		if (!event.affectedNodeIds.includes(id)) return;
		const node = this.ctx.document.get(id);
		if (!node || node.type !== 'TEXT') {
			this.stop('commit');
			return;
		}
		this.state.selection = clampSelection(node.paragraphs, this.state.selection);
		this.state.composition = null;
		this.noteMovement();
	}

	handleSelectionChange(): void {
		const id = this.state.nodeId;
		if (id === null) return;
		if (!this.ctx.selection.has(id)) this.stop('commit');
	}

	private enter(id: NodeId): void {
		this.state.nodeId = id;
		this.releaseSession = this.ctx.effect(() => {
			const leaveScope = this.ctx.keymap.pushScope('text-edit');
			const unsetKey = this.ctx.contextKeys.set('textEditing', true);
			return () => {
				unsetKey();
				leaveScope();
			};
		}, 'text-edit/session');
	}

	private initialSelection(node: TextNode, options: StartOptions): TextSelection {
		if (options.selectAll === true) return selectAll(node.paragraphs);
		if (options.point !== undefined) {
			const position = this.positionAtWorld(node.id, options.point);
			return collapsedAt(position);
		}
		return collapsedAt(documentEnd(node.paragraphs));
	}

	// ---------- selection ----------

	setSelection(selection: TextSelection): void {
		this.state.selection = selection;
		this.state.typingStyle = null;
		this.stickyX = null;
		this.noteMovement();
	}

	selectEverything(): void {
		this.setSelection(selectAll(this.editedNode().paragraphs));
	}

	/** Caret placement by pointer: click, Shift+click, double click (word), triple click. */
	pointerAt(point: Point, options: { extend: boolean; clicks: number }): void {
		const node = this.editedNode();
		const position = this.positionAtWorld(node.id, point);
		if (options.clicks >= 3) {
			this.setSelection(selectParagraphAt(node.paragraphs, position));
			return;
		}
		if (options.clicks === 2) {
			this.setSelection(selectWordAt(node.paragraphs, position));
			return;
		}
		this.setSelection(moveFocus(this.state.selection, position, options.extend));
	}

	/** Pointer drag: extend the selection to `point`. */
	dragTo(point: Point): void {
		const node = this.editedNode();
		const position = this.positionAtWorld(node.id, point);
		this.state.selection = moveFocus(this.state.selection, position, true);
		this.noteMovement();
	}

	/** World point to a text position in the edited node. */
	positionAtWorld(id: NodeId, point: Point): TextPosition {
		const inverse = invertMatrix(this.ctx.document.absoluteTransform(id));
		const local = inverse ? transformPoint(inverse, point.x, point.y) : point;
		return this.ctx.textLayout.offsetAtPoint(id, local);
	}

	/** Whether the world point lies on the edited text (with a few pixels of slack). */
	containsWorldPoint(point: Point): boolean {
		const id = this.state.nodeId;
		if (id === null) return false;
		const inverse = invertMatrix(this.ctx.document.absoluteTransform(id));
		if (!inverse) return false;
		const local = transformPoint(inverse, point.x, point.y);
		const node = this.editedNode();
		const slack = HIT_SLACK_PX / this.ctx.viewport.zoom;
		const height = Math.max(node.height, this.ctx.textLayout.measure(id).height);
		return (
			local.x >= -slack &&
			local.y >= -slack &&
			local.x <= node.width + slack &&
			local.y <= height + slack
		);
	}

	// ---------- caret movement ----------

	move(request: MoveRequest): void {
		const node = this.editedNode();
		const selection = this.state.selection;
		const extend = request.extend === true;
		if (!extend && !isCollapsed(selection) && request.unit === 'character') {
			const { start, end } = selectionRange(selection);
			this.setSelection(collapsedAt(request.direction < 0 ? start : end));
			return;
		}
		const keepSticky = request.unit === 'line';
		const sticky = this.stickyX;
		const target = this.moveTarget(node, selection.focus, request);
		this.state.selection = moveFocus(selection, target, extend);
		this.state.typingStyle = null;
		this.stickyX = keepSticky ? sticky : null;
		this.noteMovement();
	}

	private moveTarget(node: TextNode, focus: TextPosition, request: MoveRequest): TextPosition {
		const paragraphs = node.paragraphs;
		if (request.unit === 'character') return stepGrapheme(paragraphs, focus, request.direction);
		if (request.unit === 'word') return stepWord(paragraphs, focus, request.direction);
		if (request.unit === 'document') {
			if (request.direction < 0) return documentStart();
			return documentEnd(paragraphs);
		}
		if (request.unit === 'line-edge') return this.lineEdge(node, focus, request.direction);
		return this.verticalTarget(node, focus, request.direction);
	}

	private lineEdge(node: TextNode, focus: TextPosition, direction: -1 | 1): TextPosition {
		const layout = this.ctx.textLayout;
		const line = layout.lineBounds(node.id, focus);
		if (direction < 0) return { paragraph: focus.paragraph, offset: line.start };
		const lastLine = line.lineNumber >= layout.lineCount(node.id, focus.paragraph) - 1;
		if (lastLine) return paragraphEnd(node.paragraphs, focus);
		return { paragraph: focus.paragraph, offset: line.end };
	}

	// Up and Down keep the horizontal position (`stickyX`) across lines; on the first or last
	// line they go to the start or end of the text, as browsers do.
	private verticalTarget(node: TextNode, focus: TextPosition, direction: -1 | 1): TextPosition {
		const layout = this.ctx.textLayout;
		const caret = layout.caretRect(node.id, focus);
		if (this.stickyX === null) this.stickyX = caret.x;
		const line = layout.lineBounds(node.id, focus);
		const lastParagraph = node.paragraphs.length - 1;
		if (direction < 0 && focus.paragraph === 0 && line.lineNumber === 0) return documentStart();
		const onLastLine =
			focus.paragraph === lastParagraph &&
			line.lineNumber >= layout.lineCount(node.id, focus.paragraph) - 1;
		if (direction > 0 && onLastLine) return documentEnd(node.paragraphs);
		const probeY = direction < 0 ? caret.y - 1 : caret.y + caret.height + 1;
		return layout.offsetAtPoint(node.id, { x: this.stickyX, y: probeY });
	}

	// ---------- edits ----------

	insertText(text: string): void {
		this.edit(
			(node, selection) =>
				replaceSelection(node.paragraphs, selection, text, this.typingStyleOrUndefined()),
			'type'
		);
	}

	insertParagraph(): void {
		this.edit(
			(node, selection) =>
				insertParagraphBreak(node.paragraphs, selection, this.typingStyleOrUndefined()),
			'other'
		);
	}

	deleteBackward(unit: DeleteUnit = 'grapheme'): void {
		this.edit((node, selection) => deleteBackward(node.paragraphs, selection, unit), 'delete');
	}

	deleteForward(unit: DeleteUnit = 'grapheme'): void {
		this.edit((node, selection) => deleteForward(node.paragraphs, selection, unit), 'delete');
	}

	/** Replace the paragraphs wholesale (formatting, lists); the selection stays where it is. */
	replaceParagraphs(paragraphs: Paragraph[], label: string, mergeKey?: string): void {
		const node = this.editedNode();
		const selection = clampSelection(paragraphs, this.state.selection);
		this.commitParagraphs(node, paragraphs, selection, label, mergeKey);
		this.lastKind = null;
	}

	private edit(
		compute: (node: TextNode, selection: TextSelection) => EditResult,
		kind: EditKind
	): void {
		if (this.state.composition) return;
		const node = this.editedNode();
		const result = compute(node, this.state.selection);
		this.commitParagraphs(
			node,
			result.paragraphs,
			result.selection,
			LABELS[kind],
			this.mergeKeyFor(node.id, kind)
		);
		this.stickyX = null;
		if (kind === 'type') return;
		this.state.typingStyle = null;
	}

	private typingStyleOrUndefined(): Partial<TextStyle> | undefined {
		const style = this.state.typingStyle;
		if (style === null) return undefined;
		return style;
	}

	private mergeKeyFor(id: NodeId, kind: EditKind): string | undefined {
		if (kind === 'other') {
			this.lastKind = null;
			return undefined;
		}
		if (this.lastKind !== kind) {
			this.segment += 1;
			this.lastKind = kind;
		}
		return `text-${kind}:${id}:${this.segment}`;
	}

	private commitParagraphs(
		node: TextNode,
		paragraphs: Paragraph[],
		selection: TextSelection,
		label: string,
		mergeKey: string | undefined
	): void {
		if (!deepEqual(node.paragraphs, paragraphs)) {
			this.applying = true;
			try {
				this.ctx.document.apply([paragraphsChange(node, paragraphs)], {
					origin: 'user',
					label,
					mergeKey
				});
			} finally {
				this.applying = false;
			}
		}
		this.state.selection = selection;
		this.state.activity += 1;
	}

	// ---------- clipboard ----------

	/** What Ctrl+C puts on the clipboard; null with nothing selected. */
	copyPayload(): ClipboardPayload | null {
		const node = this.editedNode();
		const selection = this.state.selection;
		if (isCollapsed(selection)) return null;
		const fragment = resolveFragment(fragmentOf(node.paragraphs, selection), node.defaultStyle);
		return {
			text: selectedText(node.paragraphs, selection),
			rich: JSON.stringify({ version: 1, paragraphs: fragment })
		};
	}

	cutPayload(): ClipboardPayload | null {
		const payload = this.copyPayload();
		if (payload === null) return null;
		this.edit((node, selection) => deleteBackward(node.paragraphs, selection), 'other');
		return payload;
	}

	/** Paste from the clipboard: the rich payload when it parses, otherwise plain text. */
	paste(payload: { text: string; rich?: string }): void {
		const fragment = this.parseRich(payload.rich);
		if (fragment === null) {
			if (payload.text === '') return;
			this.edit(
				(node, selection) => replaceSelection(node.paragraphs, selection, payload.text),
				'other'
			);
			return;
		}
		this.edit(
			(node, selection) =>
				pasteFragment(node.paragraphs, selection, adoptFragment(fragment, node.defaultStyle)),
			'other'
		);
	}

	private parseRich(rich: string | undefined): Paragraph[] | null {
		if (rich === undefined || rich === '') return null;
		try {
			const parsed: unknown = JSON.parse(rich);
			if (typeof parsed !== 'object' || parsed === null) return null;
			const paragraphs: unknown = Reflect.get(parsed, 'paragraphs');
			if (!Array.isArray(paragraphs) || paragraphs.length === 0) return null;
			return paragraphs as Paragraph[];
		} catch {
			return null;
		}
	}

	// ---------- IME composition ----------

	/**
	 * The IME is composing: its provisional text lives in the document so it is laid out and drawn
	 * like any text, and is replaced as the composition changes. All of it is one undo step.
	 */
	beginComposition(): void {
		if (this.state.composition !== null) return;
		const node = this.editedNode();
		let selection = this.state.selection;
		if (!isCollapsed(selection)) {
			const result = deleteForward(node.paragraphs, selection);
			this.commitParagraphs(
				node,
				result.paragraphs,
				result.selection,
				'Type text',
				this.compositionKey(node.id)
			);
			selection = result.selection;
		}
		this.state.composition = { start: selection.focus, length: 0 };
		this.releaseComposing = this.ctx.effect(
			() => this.ctx.contextKeys.set('textComposing', true),
			'text-edit/composing'
		);
	}

	updateComposition(text: string): void {
		const composition = this.state.composition;
		if (composition === null) return;
		const node = this.editedNode();
		const range: TextSelection = {
			anchor: composition.start,
			focus: {
				paragraph: composition.start.paragraph,
				offset: composition.start.offset + composition.length
			}
		};
		const result = replaceSelection(node.paragraphs, range, text, this.typingStyleOrUndefined());
		this.commitParagraphs(
			node,
			result.paragraphs,
			result.selection,
			'Type text',
			this.compositionKey(node.id)
		);
		this.state.composition = { start: composition.start, length: text.length };
	}

	endComposition(text: string): void {
		if (this.state.composition === null) return;
		this.updateComposition(text);
		this.state.composition = null;
		void this.releaseComposing?.();
		this.releaseComposing = undefined;
		this.lastKind = null;
	}

	private currentCompositionText(): string {
		const composition = this.state.composition;
		if (composition === null) return '';
		const node = this.editedNode();
		const text = node.paragraphs[composition.start.paragraph].runs.map((run) => run.text).join('');
		return text.slice(composition.start.offset, composition.start.offset + composition.length);
	}

	private compositionKey(id: NodeId): string {
		if (this.lastKind !== null) {
			this.segment += 1;
			this.lastKind = null;
		}
		return `text-composition:${id}:${this.segment}`;
	}

	// ---------- helpers ----------

	/** A caret move or edit: forget the typing coalescing and restart the caret blink. */
	private noteMovement(): void {
		this.lastKind = null;
		this.state.activity += 1;
	}
}
