// Text layout with CanvasKit's Paragraph (HarfBuzz + ICU) from the paragraphs-of-runs model
// (docs/design/data-model.md section 3). Pure of kernel and Svelte: it needs a CanvasKit, a
// SkiaTracker and a way to resolve a font reference to a face.
//
// One Skia Paragraph per document paragraph, stacked vertically, because Skia has one alignment,
// one list marker and one spacing per Paragraph. The steps fed to each ParagraphBuilder are the
// pure plan of `buildPlan` (pushStyle / addText / pop). Layouts are cached per node and reused
// while the node's text inputs are unchanged (same objects, or deep-equal after variable
// resolution); a font arriving invalidates everything. Layout is derived data: never saved.
//
// Offsets are UTF-16 code units inside a paragraph, like `TextPosition` in document/text.ts.
// Rects and points are in the node's local space, with the text block's vertical alignment
// applied (`blockOffsetY`).

import type {
	Canvas,
	CanvasKit,
	Paragraph as SkiaParagraph,
	ParagraphBuilder,
	ParagraphStyle,
	TextStyle as SkiaTextStyle,
	TypefaceFontProvider
} from 'canvaskit-wasm';
import {
	buildPlan,
	deepEqual,
	type ParagraphPlan,
	type TextPosition,
	type TextRange
} from '../document/text';
import type { NodeId, Paint, Paragraph, TextNode, TextStyle } from '../document/types';
import type { FontEntry, FontRef, ResolvedFont } from '../fonts/resolve';
import type { SkiaTracker } from '../renderer/ownership';
import { faceKey } from './fontFace';

export type FaceResolver = (ref: FontRef) => ResolvedFont;

export interface ParagraphLayout {
	index: number;
	/** Top of the paragraph inside the text block. */
	top: number;
	/** Left edge of the text (paragraph indent plus list indent). */
	left: number;
	width: number;
	height: number;
	lineCount: number;
	/** Characters in the document paragraph. */
	length: number;
	/** False when truncation hides the paragraph. */
	visible: boolean;
	skia: SkiaParagraph | null;
	marker: { skia: SkiaParagraph; x: number } | null;
}

export interface NodeTextLayout {
	nodeId: NodeId;
	/** Width the text was laid out against: the node width, or the widest line for auto width. */
	width: number;
	/** Height of the text block. */
	height: number;
	lineCount: number;
	paragraphs: ParagraphLayout[];
	/** Faces the text needs that were not registered when it was laid out. */
	pendingFaces: FontEntry[];
	/** Faces the document references that are not installed: drawn with a substitute. */
	missingFonts: FontRef[];
}

export interface TextMeasure {
	width: number;
	height: number;
	lineCount: number;
}

export interface LineBounds {
	/** Offsets inside the paragraph; `end` excludes the line break. */
	start: number;
	end: number;
	lineNumber: number;
}

interface CacheEntry {
	inputs: LayoutInputs;
	version: number;
	layout: NodeTextLayout;
}

interface LayoutInputs {
	paragraphs: Paragraph[];
	defaultStyle: TextStyle;
	autoResize: TextNode['textAutoResize'];
	width: number;
	truncation: TextNode['textTruncation'];
	maxLines: number | null;
	leadingTrim: TextNode['leadingTrim'];
}

const UNBOUNDED_WIDTH = 100000;
const LIST_INDENT = 24;
const MARKER_GAP = 6;
const BULLETS = ['•', '–', '•'];

function inputsOf(node: TextNode): LayoutInputs {
	return {
		paragraphs: node.paragraphs,
		defaultStyle: node.defaultStyle,
		autoResize: node.textAutoResize,
		width: node.width,
		truncation: node.textTruncation,
		maxLines: node.maxLines,
		leadingTrim: node.leadingTrim
	};
}

function sameInputs(left: LayoutInputs, right: LayoutInputs): boolean {
	if (left.autoResize !== right.autoResize) return false;
	if (left.truncation !== right.truncation) return false;
	if (left.maxLines !== right.maxLines) return false;
	if (left.leadingTrim !== right.leadingTrim) return false;
	if (left.autoResize !== 'WIDTH_AND_HEIGHT' && left.width !== right.width) return false;
	if (left.paragraphs !== right.paragraphs && !deepEqual(left.paragraphs, right.paragraphs)) {
		return false;
	}
	return (
		left.defaultStyle === right.defaultStyle || deepEqual(left.defaultStyle, right.defaultStyle)
	);
}

function transformCase(text: string, textCase: TextStyle['textCase']): string {
	if (textCase === 'UPPER' || textCase === 'SMALL_CAPS_FORCED') return mapChars(text, 'upper');
	if (textCase === 'LOWER') return mapChars(text, 'lower');
	if (textCase === 'TITLE') return titleCase(text);
	return text;
}

// Per character, and only when the length stays the same: offsets must keep matching the model.
function mapChars(text: string, mode: 'upper' | 'lower'): string {
	let result = '';
	for (const char of text) {
		const mapped = mode === 'upper' ? char.toUpperCase() : char.toLowerCase();
		result += mapped.length === char.length ? mapped : char;
	}
	return result;
}

function titleCase(text: string): string {
	let result = '';
	let atWordStart = true;
	for (const char of text) {
		result += atWordStart ? mapChars(char, 'upper') : char;
		atWordStart = /\s/.test(char);
	}
	return result;
}

/** The first visible solid fill, else the first stop of a gradient, else black. */
function textColor(fills: Paint[]): [number, number, number, number] {
	for (const fill of fills) {
		if (!fill.visible) continue;
		if (fill.type === 'SOLID') return [fill.color.r, fill.color.g, fill.color.b, fill.opacity];
		if (fill.type !== 'IMAGE' && fill.gradientStops.length > 0) {
			const color = fill.gradientStops[0].color;
			return [color.r, color.g, color.b, fill.opacity * color.a];
		}
	}
	return [0, 0, 0, 1];
}

function lineHeightMultiplier(style: TextStyle): number {
	const height = style.lineHeight;
	if (height.unit === 'AUTO') return 0;
	if (height.unit === 'PERCENT') return height.value / 100;
	return height.value / style.fontSize;
}

function letterSpacingPixels(style: TextStyle): number {
	const spacing = style.letterSpacing;
	if (spacing.unit === 'PERCENT') return (spacing.value / 100) * style.fontSize;
	return spacing.value;
}

export class TextLayoutEngine {
	private readonly provider: TypefaceFontProvider;
	private readonly registered = new Map<string, FontEntry>();
	private readonly cache = new Map<NodeId, CacheEntry>();
	private version = 0;
	private builds = 0;

	constructor(
		private readonly kit: CanvasKit,
		private readonly tracker: SkiaTracker,
		private readonly resolve: FaceResolver
	) {
		this.provider = tracker.track(kit.TypefaceFontProvider.Make());
	}

	/** How many layouts were computed (not served from the cache) so far. */
	get buildCount(): number {
		return this.builds;
	}

	get cachedNodeCount(): number {
		return this.cache.size;
	}

	isRegistered(face: FontRef): boolean {
		return this.registered.has(faceKey(face));
	}

	/** Make `bytes` available under `face`; every cached layout is stale afterwards. */
	registerFont(face: FontEntry, bytes: ArrayBuffer): void {
		const key = faceKey(face);
		if (this.registered.has(key)) return;
		this.provider.registerFont(bytes, key);
		this.registered.set(key, face);
		this.invalidateAll();
	}

	invalidateAll(): void {
		this.version += 1;
	}

	forget(nodeId: NodeId): void {
		const entry = this.cache.get(nodeId);
		if (!entry) return;
		this.cache.delete(nodeId);
		this.deleteLayout(entry.layout);
	}

	clear(): void {
		for (const nodeId of this.cache.keys()) this.forget(nodeId);
	}

	dispose(): void {
		this.clear();
		this.provider.delete();
	}

	/** The layout of `node`, from the cache while its inputs and the fonts are unchanged. */
	layout(node: TextNode): NodeTextLayout {
		const inputs = inputsOf(node);
		const cached = this.cache.get(node.id);
		if (cached && cached.version === this.version && sameInputs(cached.inputs, inputs)) {
			return cached.layout;
		}
		if (cached) this.deleteLayout(cached.layout);
		const layout = this.build(node);
		this.cache.set(node.id, { inputs, version: this.version, layout });
		return layout;
	}

	measure(node: TextNode): TextMeasure {
		const layout = this.layout(node);
		return { width: layout.width, height: layout.height, lineCount: layout.lineCount };
	}

	/** Where the text block starts vertically inside the node's box. */
	blockOffsetY(node: TextNode): number {
		const free = node.height - this.layout(node).height;
		if (free <= 0) return 0;
		if (node.textAlignVertical === 'CENTER') return free / 2;
		if (node.textAlignVertical === 'BOTTOM') return free;
		return 0;
	}

	/** Draw the text into `canvas`, in the node's local space. */
	draw(canvas: Canvas, node: TextNode): void {
		const layout = this.layout(node);
		const offsetY = this.blockOffsetY(node);
		for (const item of layout.paragraphs) {
			if (!item.visible || !item.skia) continue;
			if (item.marker) canvas.drawParagraph(item.marker.skia, item.marker.x, offsetY + item.top);
			canvas.drawParagraph(item.skia, item.left, offsetY + item.top);
		}
	}

	// ---------- geometry for caret, selection and hit testing ----------

	/** Caret rectangle at `position` (zero width), in node-local coordinates. */
	caretRect(node: TextNode, position: TextPosition): Rect {
		const layout = this.layout(node);
		const item = this.paragraphAt(layout, position.paragraph);
		const offsetY = this.blockOffsetY(node);
		const top = offsetY + item.top;
		if (!item.skia || item.length === 0) {
			return this.emptyCaret(node, item, top);
		}
		const boxes = this.charBoxes(item, position.offset);
		const box = boxes.box;
		const x = boxes.after ? box.right : box.left;
		return { x: item.left + x, y: top + box.top, width: 0, height: box.bottom - box.top };
	}

	/** One rectangle per line covered by the range, node-local. */
	rangeRects(node: TextNode, range: TextRange): Rect[] {
		const layout = this.layout(node);
		const offsetY = this.blockOffsetY(node);
		const rects: Rect[] = [];
		for (let index = range.start.paragraph; index <= range.end.paragraph; index += 1) {
			const item = this.paragraphAt(layout, index);
			const from = index === range.start.paragraph ? range.start.offset : 0;
			const to = index === range.end.paragraph ? range.end.offset : item.length;
			rects.push(
				...this.paragraphRects(node, item, offsetY, from, to, index < range.end.paragraph)
			);
		}
		return rects;
	}

	/** The position nearest to `point` (node-local). */
	offsetAtPoint(node: TextNode, point: { x: number; y: number }): TextPosition {
		const layout = this.layout(node);
		const localY = point.y - this.blockOffsetY(node);
		const item = this.paragraphAtY(layout, localY);
		if (!item.skia) return { paragraph: item.index, offset: 0 };
		const hit = item.skia.getGlyphPositionAtCoordinate(point.x - item.left, localY - item.top);
		return { paragraph: item.index, offset: Math.min(Math.max(hit.pos, 0), item.length) };
	}

	/** The visual line holding `position`: for Home / End and up / down movement. */
	lineBounds(node: TextNode, position: TextPosition): LineBounds {
		const item = this.paragraphAt(this.layout(node), position.paragraph);
		if (!item.skia || item.length === 0) return { start: 0, end: 0, lineNumber: 0 };
		const lines = item.skia.getLineMetrics();
		let found = lines[lines.length - 1];
		for (const line of lines) {
			const holdsOffset = position.offset >= line.startIndex && position.offset < line.endIndex;
			if (holdsOffset) {
				found = line;
				break;
			}
		}
		return {
			start: found.startIndex,
			end: Math.min(found.endExcludingWhitespaces, item.length),
			lineNumber: found.lineNumber
		};
	}

	/** Start and end of the word at `position`, inside its paragraph. */
	wordBoundary(node: TextNode, position: TextPosition): { start: number; end: number } {
		const item = this.paragraphAt(this.layout(node), position.paragraph);
		if (!item.skia || item.length === 0) return { start: 0, end: 0 };
		const probe = Math.min(position.offset, item.length - 1);
		const range = item.skia.getWordBoundary(probe);
		return { start: range.start, end: Math.min(range.end, item.length) };
	}

	lineCount(node: TextNode, paragraph: number): number {
		return this.paragraphAt(this.layout(node), paragraph).lineCount;
	}

	// ---------- building ----------

	private build(node: TextNode): NodeTextLayout {
		this.builds += 1;
		const plans = buildPlan(node.paragraphs, node.defaultStyle);
		const pending = new Map<string, FontEntry>();
		const missing = new Map<string, FontRef>();
		const faces = { pending, missing };
		const counters = this.listCounters(node.paragraphs);
		const unbounded = node.textAutoResize === 'WIDTH_AND_HEIGHT';
		const boxWidth = unbounded ? UNBOUNDED_WIDTH : node.width;
		let remainingLines = node.textTruncation === 'ENDING' ? node.maxLines : null;
		const items: ParagraphLayout[] = [];
		for (let index = 0; index < plans.length; index += 1) {
			const item = this.buildParagraph(
				node,
				plans[index],
				{ index, remainingLines, listNumber: counters[index], boxWidth },
				faces
			);
			if (remainingLines !== null) remainingLines = Math.max(0, remainingLines - item.lineCount);
			items.push(item);
		}
		const width = unbounded ? this.fitWidth(items) : node.width;
		if (unbounded) this.relayout(items, width);
		const lineCount = items.reduce((total, item) => total + item.lineCount, 0);
		return {
			nodeId: node.id,
			width,
			height: this.stack(items, plans),
			lineCount,
			paragraphs: items,
			pendingFaces: [...pending.values()],
			missingFonts: [...missing.values()]
		};
	}

	private listCounters(paragraphs: Paragraph[]): number[] {
		const counts: number[] = [];
		const open: number[] = [];
		for (const paragraph of paragraphs) {
			if (paragraph.list !== 'ORDERED') {
				open.length = 0;
				counts.push(0);
				continue;
			}
			open.length = paragraph.listLevel + 1;
			for (let level = 0; level <= paragraph.listLevel; level += 1) {
				if (open[level] === undefined) open[level] = 0;
			}
			open[paragraph.listLevel] += 1;
			counts.push(open[paragraph.listLevel]);
		}
		return counts;
	}

	private buildParagraph(
		node: TextNode,
		plan: ParagraphPlan,
		slot: ParagraphSlot,
		faces: FaceBook
	): ParagraphLayout {
		const { index, remainingLines, listNumber, boxWidth } = slot;
		const length = node.paragraphs[index].runs.reduce((total, run) => total + run.text.length, 0);
		const left = plan.indent + this.listIndent(plan);
		const base: ParagraphLayout = {
			index,
			top: 0,
			left,
			width: 0,
			height: 0,
			lineCount: 0,
			length,
			visible: remainingLines === null || remainingLines > 0,
			skia: null,
			marker: null
		};
		if (!base.visible) return base;
		const paragraphStyle = this.paragraphStyle(node, plan, remainingLines);
		const builder = this.tracker.track(
			this.kit.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, this.provider)
		);
		this.runSteps(builder, plan, faces);
		const skia = this.tracker.track(builder.build());
		builder.delete();
		base.skia = skia;
		base.width = Math.max(1, boxWidth - left);
		skia.layout(base.width);
		base.lineCount = skia.getNumberOfLines();
		base.height = skia.getHeight();
		if (plan.list !== 'NONE') base.marker = this.buildMarker(node, plan, listNumber, left, faces);
		return base;
	}

	private listIndent(plan: ParagraphPlan): number {
		if (plan.list === 'NONE') return 0;
		return LIST_INDENT * (plan.listLevel + 1);
	}

	private buildMarker(
		node: TextNode,
		plan: ParagraphPlan,
		listNumber: number,
		left: number,
		faces: FaceBook
	): { skia: SkiaParagraph; x: number } {
		const text = this.markerText(plan, listNumber);
		const firstStep = plan.steps.find((step) => step.op === 'pushStyle');
		const style = firstStep && firstStep.op === 'pushStyle' ? firstStep.style : node.defaultStyle;
		const builder = this.tracker.track(
			this.kit.ParagraphBuilder.MakeFromFontProvider(
				new this.kit.ParagraphStyle({ textAlign: this.kit.TextAlign.Left, textStyle: {} }),
				this.provider
			)
		);
		builder.pushStyle(this.skiaTextStyle(style, faces));
		builder.addText(text);
		builder.pop();
		const skia = this.tracker.track(builder.build());
		builder.delete();
		skia.layout(UNBOUNDED_WIDTH);
		return { skia, x: left - MARKER_GAP - skia.getLongestLine() };
	}

	private markerText(plan: ParagraphPlan, listNumber: number): string {
		if (plan.list === 'UNORDERED') return BULLETS[plan.listLevel % BULLETS.length];
		if (plan.listLevel % 2 === 1)
			return `${String.fromCharCode(96 + ((listNumber - 1) % 26) + 1)}.`;
		return `${listNumber}.`;
	}

	private paragraphStyle(
		node: TextNode,
		plan: ParagraphPlan,
		remainingLines: number | null
	): ParagraphStyle {
		const { TextAlign } = this.kit;
		const alignments = {
			LEFT: TextAlign.Left,
			CENTER: TextAlign.Center,
			RIGHT: TextAlign.Right,
			JUSTIFIED: TextAlign.Justify
		};
		const style: ParagraphStyle = { textAlign: alignments[plan.align], textStyle: {} };
		if (remainingLines !== null) {
			style.maxLines = remainingLines;
			style.ellipsis = '…';
		}
		if (node.leadingTrim === 'CAP_HEIGHT') {
			style.textHeightBehavior = this.kit.TextHeightBehavior.DisableAll;
		}
		return new this.kit.ParagraphStyle(style);
	}

	private runSteps(builder: ParagraphBuilder, plan: ParagraphPlan, faces: FaceBook): void {
		let current: TextStyle | null = null;
		for (const step of plan.steps) {
			if (step.op === 'pushStyle') {
				current = step.style;
				builder.pushStyle(this.skiaTextStyle(step.style, faces));
			} else if (step.op === 'addText') {
				builder.addText(current ? transformCase(step.text, current.textCase) : step.text);
			} else {
				builder.pop();
			}
		}
	}

	private skiaTextStyle(style: TextStyle, faces: FaceBook): SkiaTextStyle {
		const resolved = this.resolve(style.fontName);
		const key = faceKey(resolved.face);
		if (!this.registered.has(key)) faces.pending.set(key, resolved.face);
		if (resolved.missing) faces.missing.set(faceKey(style.fontName), { ...style.fontName });
		const [red, green, blue, alpha] = textColor(style.fills);
		const color = this.kit.Color4f(red, green, blue, alpha);
		const decoration = this.decorationOf(style);
		const skia: SkiaTextStyle = {
			color,
			fontFamilies: this.familyList(key),
			fontSize: style.fontSize,
			letterSpacing: letterSpacingPixels(style),
			decoration,
			decorationColor: color,
			decorationThickness: 1,
			halfLeading: true,
			fontFeatures: this.fontFeatures(style),
			fontVariations: Object.entries(style.fontVariations).map(([axis, value]) => ({
				axis,
				value
			}))
		};
		const multiplier = lineHeightMultiplier(style);
		if (multiplier > 0) skia.heightMultiplier = multiplier;
		return new this.kit.TextStyle(skia);
	}

	// While the wanted face is still loading, borrow any registered face so text is not blank.
	private familyList(key: string): string[] {
		if (this.registered.has(key)) return [key];
		const [any] = this.registered.keys();
		if (any === undefined) return [key];
		return [key, any];
	}

	private decorationOf(style: TextStyle): number {
		if (style.hyperlink || style.textDecoration === 'UNDERLINE')
			return this.kit.UnderlineDecoration;
		if (style.textDecoration === 'STRIKETHROUGH') return this.kit.LineThroughDecoration;
		return 0;
	}

	private fontFeatures(style: TextStyle): { name: string; value: number }[] {
		const features = Object.entries(style.openTypeFeatures).map(([name, enabled]) => ({
			name,
			value: enabled ? 1 : 0
		}));
		if (style.textCase === 'SMALL_CAPS' || style.textCase === 'SMALL_CAPS_FORCED') {
			features.push({ name: 'smcp', value: 1 });
		}
		return features;
	}

	/** Widest line plus indent, rounded up so the re-layout never wraps. */
	private fitWidth(items: ParagraphLayout[]): number {
		let widest = 0;
		for (const item of items) {
			if (!item.skia) continue;
			widest = Math.max(widest, item.left + item.skia.getLongestLine());
		}
		return Math.ceil(widest + 0.01);
	}

	private relayout(items: ParagraphLayout[], width: number): void {
		for (const item of items) {
			if (!item.skia) continue;
			item.width = Math.max(1, width - item.left);
			item.skia.layout(item.width);
			item.lineCount = item.skia.getNumberOfLines();
			item.height = item.skia.getHeight();
		}
	}

	private stack(items: ParagraphLayout[], plans: ParagraphPlan[]): number {
		let top = 0;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			item.top = top;
			if (!item.visible) continue;
			top += item.height;
			if (index < items.length - 1) top += plans[index].spacingAfter;
		}
		return top;
	}

	private deleteLayout(layout: NodeTextLayout): void {
		for (const item of layout.paragraphs) {
			item.skia?.delete();
			item.marker?.skia.delete();
		}
	}

	// ---------- geometry helpers ----------

	private paragraphAt(layout: NodeTextLayout, index: number): ParagraphLayout {
		const item = layout.paragraphs[index];
		if (!item) throw new RangeError(`no paragraph ${index}`);
		return item;
	}

	private paragraphAtY(layout: NodeTextLayout, y: number): ParagraphLayout {
		let found = layout.paragraphs[0];
		for (const item of layout.paragraphs) {
			if (!item.visible) continue;
			if (y >= item.top) found = item;
		}
		return found;
	}

	/** Box of the character next to `offset` and whether the caret sits at its right edge. */
	private charBoxes(item: ParagraphLayout, offset: number): { box: Box; after: boolean } {
		const skia = this.requireSkia(item);
		const { RectHeightStyle, RectWidthStyle } = this.kit;
		const after = offset >= item.length;
		const from = after ? offset - 1 : offset;
		const rects = skia.getRectsForRange(from, from + 1, RectHeightStyle.Max, RectWidthStyle.Tight);
		const rect = rects[0];
		if (!rect) {
			const line = skia.getLineMetricsAt(0);
			const height = line ? line.height : item.height;
			return { box: { left: 0, right: 0, top: 0, bottom: height }, after };
		}
		const [left, top, right, bottom] = rect.rect;
		return { box: { left, right, top, bottom }, after };
	}

	private emptyCaret(node: TextNode, item: ParagraphLayout, top: number): Rect {
		const style = this.resolveFirstStyle(node, item.index);
		const lineHeight = item.height > 0 ? item.height : style.fontSize * 1.2;
		let x = item.left;
		if (node.paragraphs[item.index].align === 'CENTER') x = item.left + item.width / 2;
		if (node.paragraphs[item.index].align === 'RIGHT') x = item.left + item.width;
		return { x, y: top, width: 0, height: lineHeight };
	}

	private resolveFirstStyle(node: TextNode, paragraph: number): TextStyle {
		const first = node.paragraphs[paragraph].runs[0];
		if (!first) return node.defaultStyle;
		return { ...node.defaultStyle, ...first.style };
	}

	private paragraphRects(
		node: TextNode,
		item: ParagraphLayout,
		offsetY: number,
		from: number,
		to: number,
		includeBreak: boolean
	): Rect[] {
		const rects: Rect[] = [];
		const top = offsetY + item.top;
		if (item.skia && to > from) {
			const { RectHeightStyle, RectWidthStyle } = this.kit;
			const boxes = item.skia.getRectsForRange(from, to, RectHeightStyle.Max, RectWidthStyle.Tight);
			for (const entry of boxes) {
				const [left, boxTop, right, bottom] = entry.rect;
				rects.push({
					x: item.left + left,
					y: top + boxTop,
					width: right - left,
					height: bottom - boxTop
				});
			}
		}
		if (includeBreak) rects.push(this.breakRect(node, item, top));
		return rects;
	}

	// The newline of a paragraph that continues into the next shows as a narrow block, like editors do.
	private breakRect(node: TextNode, item: ParagraphLayout, top: number): Rect {
		const end = this.caretRect(node, { paragraph: item.index, offset: item.length });
		const style = this.resolveFirstStyle(node, item.index);
		return {
			x: end.x,
			y: end.y,
			width: Math.max(4, style.fontSize * 0.3),
			height: end.height || top
		};
	}

	private requireSkia(item: ParagraphLayout): SkiaParagraph {
		if (!item.skia) throw new Error('paragraph is hidden by truncation');
		return item.skia;
	}
}

interface ParagraphSlot {
	index: number;
	remainingLines: number | null;
	listNumber: number;
	boxWidth: number;
}

interface FaceBook {
	pending: Map<string, FontEntry>;
	missing: Map<string, FontRef>;
}

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
