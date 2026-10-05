import { Service, type Context } from '@neoworks/extension-system';
import {
	MIXED,
	type NodeId,
	type Paragraph,
	type RangeStyle,
	type TextNode,
	type TextRange,
	type TextStyle
} from '../../lib/document';
import { documentEnd, documentStart, selectionRange, styleAt } from '../../lib/text/editing';
import {
	boldPatch,
	changeListLevel,
	decorationPatch,
	fontSizePatch,
	hasListItems,
	hyperlinkPatch,
	isBold,
	isItalicStyle,
	italicPatch,
	letterSpacingPatch,
	lineHeightPatch,
	mergeRangeStyles,
	paragraphsIn,
	patchedTypingStyle,
	restyleNode,
	restyleRange,
	setAlignment,
	styleOfRange,
	toggleList,
	updateParagraphs,
	weightPatch,
	type StylePatch
} from '../../lib/text/formatting';
import { TextFormatState } from './state.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		textFormat: TextFormatService;
	}
}

interface Target {
	node: TextNode;
	/** `null` formats the whole node. */
	range: TextRange | null;
}

export type StepDirection = 1 | -1;

/**
 * Formatting for text: the selected range while editing, otherwise every selected text node as a
 * whole. All edits are plain document changes (run splitting and merging come from the pure
 * functions in lib/text/formatting.ts), so one command is one undo step and repeated steps of the
 * same kind coalesce through `mergeKey`.
 *
 * `style()` is what the typography section reads: the common value of every property over the
 * target, or `MIXED` where it differs.
 */
export class TextFormatService extends Service {
	private releasePrompt: (() => unknown) | undefined;

	constructor(
		ctx: Context,
		readonly state: TextFormatState
	) {
		super(ctx, 'textFormat');
	}

	// ---------- reads ----------

	/** True when there is something to format. */
	get hasTarget(): boolean {
		return this.targets().length > 0;
	}

	/** The style of the target: `MIXED` for a property that differs across it. */
	style(): RangeStyle {
		const targets = this.targets();
		if (targets.length === 0) return {};
		const styles = targets.map((target) => this.styleOfTarget(target));
		return mergeRangeStyles(styles);
	}

	hasLink(): boolean {
		const link = this.style().hyperlink;
		return link !== undefined && link !== MIXED;
	}

	// ---------- run styles ----------

	toggleBold(): void {
		this.applyPatch(boldPatch(!isBold(this.style())), 'Bold');
	}

	toggleItalic(): void {
		this.applyPatch(italicPatch(!isItalicStyle(this.style())), 'Italic');
	}

	toggleUnderline(): void {
		this.toggleDecoration('UNDERLINE', 'Underline');
	}

	toggleStrikethrough(): void {
		this.toggleDecoration('STRIKETHROUGH', 'Strikethrough');
	}

	private toggleDecoration(decoration: TextStyle['textDecoration'], label: string): void {
		const active = this.style().textDecoration === decoration;
		this.applyPatch(decorationPatch(active ? 'NONE' : decoration), label);
	}

	stepFontSize(direction: StepDirection): void {
		this.applyPatch(fontSizePatch(direction), 'Font size', 'font-size');
	}

	stepWeight(direction: StepDirection): void {
		this.applyPatch(weightPatch(direction * 100), 'Font weight', 'weight');
	}

	stepLineHeight(direction: StepDirection): void {
		this.applyPatch(lineHeightPatch(direction), 'Line height', 'line-height');
	}

	stepLetterSpacing(direction: StepDirection): void {
		this.applyPatch(letterSpacingPatch(direction), 'Letter spacing', 'letter-spacing');
	}

	/** A patch from outside (the typography section sets exact values). */
	applyPatch(patch: StylePatch, label: string, coalesceKey?: string): void {
		const edit = this.editTarget();
		if (edit) {
			this.patchEditedText(edit, patch, label, coalesceKey);
			return;
		}
		this.patchSelectedNodes(patch, label, coalesceKey);
	}

	// ---------- paragraphs ----------

	setAlignment(align: Paragraph['align']): void {
		this.updateParagraphs(
			(paragraphs, range) => setAlignment(paragraphs, range, align),
			'Text align'
		);
	}

	toggleList(kind: 'ORDERED' | 'UNORDERED'): void {
		this.updateParagraphs(
			(paragraphs, range) => toggleList(paragraphs, range, kind),
			kind === 'ORDERED' ? 'Numbered list' : 'Bulleted list'
		);
	}

	/** Spacing after and indent of every touched paragraph (the typography section's settings). */
	setParagraphProps(
		props: Partial<Pick<Paragraph, 'indent' | 'spacingAfter'>>,
		label: string
	): void {
		this.updateParagraphs(
			(paragraphs, range) =>
				updateParagraphs(paragraphs, range, (paragraph) => ({ ...paragraph, ...props })),
			label
		);
	}

	/** The paragraphs the next paragraph command touches: those of the range, or every one. */
	touchedParagraphs(): Paragraph[] {
		return this.targets().flatMap((target) =>
			paragraphsIn(target.node.paragraphs, this.paragraphRange(target))
		);
	}

	/** Tab and Shift+Tab: the list level of the touched list items. */
	changeListLevel(delta: 1 | -1): void {
		this.updateParagraphs(
			(paragraphs, range) => changeListLevel(paragraphs, range, delta),
			'List level'
		);
	}

	/** Whether the target has list items (Tab only means "indent" there). */
	inList(): boolean {
		return this.targets().some((target) =>
			hasListItems(target.node.paragraphs, this.paragraphRange(target))
		);
	}

	// ---------- links ----------

	setLink(url: string): void {
		const trimmed = url.trim();
		if (trimmed === '') {
			this.applyPatch(hyperlinkPatch(null), 'Remove link');
			return;
		}
		this.applyPatch(hyperlinkPatch({ type: 'URL', value: trimmed }), 'Add link');
	}

	removeLink(): void {
		this.applyPatch(hyperlinkPatch(null), 'Remove link');
	}

	/** Open the link prompt, pre-filled with the link of the selection. */
	openLinkPrompt(): void {
		if (!this.hasTarget || this.state.linkPrompt !== null) return;
		const link = this.style().hyperlink;
		let url = '';
		if (link !== undefined && link !== MIXED) url = link.value;
		this.state.linkPrompt = { url };
		this.releasePrompt = this.ctx.effect(
			() => this.ctx.contextKeys.set('textEditSuspended', true),
			'text-format/link prompt'
		);
	}

	closeLinkPrompt(apply: boolean, url?: string): void {
		if (this.state.linkPrompt === null) return;
		this.state.linkPrompt = null;
		void this.releasePrompt?.();
		this.releasePrompt = undefined;
		if (apply && url !== undefined) this.setLink(url);
		if (this.ctx.textEdit.active) this.ctx.textEdit.focusInput();
	}

	snapshotState(): unknown {
		return { linkPrompt: this.state.linkPrompt !== null };
	}

	// ---------- targets ----------

	/** The edited text with the selected range, else the selected text nodes as a whole. */
	private targets(): Target[] {
		const edit = this.editTarget();
		if (edit) return [edit];
		const targets: Target[] = [];
		for (const id of this.ctx.selection.ids) {
			const node = this.ctx.document.get(id);
			if (node && node.type === 'TEXT' && !node.locked) targets.push({ node, range: null });
		}
		return targets;
	}

	private editTarget(): Target | null {
		if (!this.ctx.textEdit.active) return null;
		const node = this.ctx.textEdit.editedNode();
		return { node, range: selectionRange(this.ctx.textEdit.selection) };
	}

	private wholeRange(node: TextNode): TextRange {
		return { start: documentStart(), end: documentEnd(node.paragraphs) };
	}

	private paragraphRange(target: Target): TextRange {
		return target.range === null ? this.wholeRange(target.node) : target.range;
	}

	private styleOfTarget(target: Target): RangeStyle {
		const { node } = target;
		const range = this.paragraphRange(target);
		const base = styleOfRange(node.paragraphs, node.defaultStyle, range);
		if (target.range === null) return base;
		const typing = this.ctx.textEdit.state.typingStyle;
		if (typing === null || !this.isCollapsed(range)) return base;
		return { ...base, ...typing };
	}

	private isCollapsed(range: TextRange): boolean {
		return range.start.paragraph === range.end.paragraph && range.start.offset === range.end.offset;
	}

	// ---------- applying ----------

	private patchEditedText(
		target: Target,
		patch: StylePatch,
		label: string,
		coalesceKey: string | undefined
	): void {
		const { node } = target;
		const range = this.paragraphRange(target);
		if (this.isCollapsed(range)) {
			const typing = this.ctx.textEdit.state.typingStyle;
			const caretStyle = { ...styleAt(node.paragraphs, range.start), ...typing };
			this.ctx.textEdit.setTypingStyle(patchedTypingStyle(caretStyle, node.defaultStyle, patch));
			return;
		}
		const paragraphs = restyleRange(node.paragraphs, node.defaultStyle, range, patch);
		this.ctx.textEdit.replaceParagraphs(paragraphs, label, this.mergeKey(coalesceKey, [node.id]));
	}

	private patchSelectedNodes(
		patch: StylePatch,
		label: string,
		coalesceKey: string | undefined
	): void {
		const targets = this.targets();
		if (targets.length === 0) return;
		const ids = targets.map((target) => target.node.id);
		this.ctx.document.transaction(
			{ origin: 'user', label, mergeKey: this.mergeKey(coalesceKey, ids) },
			() => {
				for (const { node } of targets) {
					const restyled = restyleNode(node.paragraphs, node.defaultStyle, patch);
					this.ctx.document.apply(
						this.ctx.document.setProps(node.id, {
							paragraphs: restyled.paragraphs,
							defaultStyle: restyled.defaultStyle
						}),
						{ origin: 'user', label }
					);
				}
			}
		);
	}

	private updateParagraphs(
		change: (paragraphs: Paragraph[], range: TextRange | null) => Paragraph[],
		label: string
	): void {
		const edit = this.editTarget();
		if (edit) {
			const paragraphs = change(edit.node.paragraphs, this.paragraphRange(edit));
			this.ctx.textEdit.replaceParagraphs(paragraphs, label);
			return;
		}
		const targets = this.targets();
		if (targets.length === 0) return;
		this.ctx.document.transaction({ origin: 'user', label }, () => {
			for (const { node } of targets) {
				const paragraphs = change(node.paragraphs, null);
				this.ctx.document.apply(this.ctx.document.setProps(node.id, { paragraphs }), {
					origin: 'user',
					label
				});
			}
		});
	}

	private mergeKey(kind: string | undefined, ids: NodeId[]): string | undefined {
		if (kind === undefined) return undefined;
		return `text-format:${kind}:${ids.join(',')}`;
	}
}
