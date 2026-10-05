// Document nodes as HTML for the model to read, in the same vocabulary `convert.ts` reads back:
// a `<div>` per frame with inline flexbox for auto layout, `<p>` per text layer with `<span>`s for
// styled runs, absolute positions inside frames without auto layout, `var(--name)` where a value
// is bound to a variable, `data-component` on instances and `data-id` on every element so edits
// can address the layers. Pure: no DOM. Vector shapes are drawn by an injected callback (the SVG
// exporter needs the renderer's geometry).
//
// The markup assumes the reset the converter applies: `* { box-sizing: border-box; margin: 0 }`.

import {
	invertMatrix,
	type Effect,
	type GradientPaint,
	type BoundVariables,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Paint,
	type Paragraph,
	type RGB,
	type Stroke,
	type TextNode,
	type TextStyle
} from '../../document';
import { isItalic } from '../../text/fontFace';
import type { TreeSource } from '../tools/serialize';

export interface HtmlSerializeOptions {
	/** Levels below each root to write out; deeper layers are summarised. Default 6. */
	depth?: number;
	/** Most elements written; the rest are summarised. Default 400. */
	budget?: number;
	/** Variable id to CSS custom property name (`--surface`). */
	cssNames?: Readonly<Record<string, string>>;
	/** Component node id to the name `data-component` uses. */
	componentNames?: Readonly<Record<NodeId, string>>;
	/** Inline SVG for a vector-like layer, sized to its box; omitted layers become a placeholder. */
	vectorSvg?: (id: NodeId) => string | null;
}

const DEFAULT_DEPTH = 6;
const DEFAULT_BUDGET = 400;
const VECTOR_TYPES = new Set(['VECTOR', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION']);

function number(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

function px(value: number): string {
	if (value === 0) return '0';
	return `${number(value)}px`;
}

function hex(color: RGB): string {
	const channel = (value: number): string =>
		Math.round(Math.min(1, Math.max(0, value)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function cssColor(color: RGB, alpha: number): string {
	if (alpha >= 1) return hex(color);
	const channel = (value: number): number => Math.round(value * 255);
	return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${number(alpha)})`;
}

function escapeText(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(text: string): string {
	return escapeText(text).replaceAll('"', '&quot;');
}

function translation(transform: Matrix2x3): { x: number; y: number } {
	return { x: transform[0][2], y: transform[1][2] };
}

function rotation(transform: Matrix2x3): number {
	return (Math.atan2(transform[1][0], transform[0][0]) * 180) / Math.PI;
}

const JUSTIFY: Record<string, string> = {
	MIN: 'flex-start',
	CENTER: 'center',
	MAX: 'flex-end',
	SPACE_BETWEEN: 'space-between'
};

const ALIGN: Record<string, string> = {
	MIN: 'flex-start',
	CENTER: 'center',
	MAX: 'flex-end',
	BASELINE: 'baseline'
};

const TEXT_ALIGN: Record<Paragraph['align'], string> = {
	LEFT: 'left',
	CENTER: 'center',
	RIGHT: 'right',
	JUSTIFIED: 'justify'
};

const TEXT_CASE: Partial<Record<TextStyle['textCase'], string>> = {
	UPPER: 'uppercase',
	LOWER: 'lowercase',
	TITLE: 'capitalize'
};

const DECORATION: Partial<Record<TextStyle['textDecoration'], string>> = {
	UNDERLINE: 'underline',
	STRIKETHROUGH: 'line-through'
};

type Declarations = [string, string][];

function styleAttribute(declarations: Declarations): string {
	if (declarations.length === 0) return '';
	return ` style="${escapeAttribute(declarations.map(([key, value]) => `${key}:${value}`).join(';'))}"`;
}

interface ParentContext {
	layout: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
}

class HtmlWriter {
	private written = 0;
	private readonly depth: number;
	private readonly budget: number;

	constructor(
		private readonly source: TreeSource,
		private readonly options: HtmlSerializeOptions
	) {
		this.depth = options.depth ?? DEFAULT_DEPTH;
		this.budget = options.budget ?? DEFAULT_BUDGET;
	}

	root(id: NodeId): string {
		const node = this.source.resolved(id);
		const extra: string[] = [];
		if (node.type !== 'PAGE') {
			const { x, y } = translation(node.transform);
			extra.push(`data-x="${number(x)}"`, `data-y="${number(y)}"`);
		}
		return this.node(id, { layout: 'NONE' }, 0, extra, true);
	}

	private variable(id: string | undefined): string | undefined {
		if (id === undefined) return undefined;
		const name = this.options.cssNames?.[id];
		if (name === undefined) return undefined;
		return `var(${name})`;
	}

	private bound(raw: Node, property: string): string | undefined {
		const binding = raw.boundVariables?.[property];
		if (binding === undefined || Array.isArray(binding)) return undefined;
		return this.variable(binding.id);
	}

	private node(
		id: NodeId,
		parent: ParentContext,
		level: number,
		extra: string[],
		isRoot: boolean
	): string {
		const node = this.source.resolved(id);
		const raw = this.source.get(id) ?? node;
		this.written += 1;
		const attributes = [
			`data-id="${escapeAttribute(id)}"`,
			`data-name="${escapeAttribute(node.name)}"`,
			...extra
		];
		if (node.type === 'PAGE') {
			return `<div ${attributes.join(' ')}>${this.children(id, { layout: 'NONE' }, level)}</div>`;
		}
		if (node.type === 'INSTANCE') {
			const component = this.options.componentNames?.[node.mainComponentId];
			if (component !== undefined)
				attributes.push(`data-component="${escapeAttribute(component)}"`);
		}
		if (node.type === 'COMPONENT') attributes.push('data-main-component');
		const declarations: Declarations = [];
		this.placement(node, raw, parent, isRoot, declarations);
		this.appearance(node, declarations);
		if (node.type === 'TEXT') {
			this.textStyle(node, raw, declarations);
			const open = `<p ${attributes.join(' ')}${styleAttribute(declarations)}>`;
			return `${open}${this.paragraphs(node)}</p>`;
		}
		if (VECTOR_TYPES.has(node.type)) {
			const svg = this.options.vectorSvg?.(id) ?? null;
			if (svg !== null)
				return svg.replace('<svg', `<svg ${attributes.join(' ')}${styleAttribute(declarations)}`);
		}
		this.box(node, raw, declarations);
		const layout = this.layout(node, raw, declarations);
		let inner = '';
		if (level >= this.depth || this.written >= this.budget) {
			const count = this.source.children(id).length;
			if (count > 0) attributes.push(`data-children="${count}"`);
		} else {
			inner = this.children(id, { layout }, level + 1);
		}
		return `<div ${attributes.join(' ')}${styleAttribute(declarations)}>${inner}</div>`;
	}

	private children(id: NodeId, context: ParentContext, level: number): string {
		return this.source
			.children(id)
			.map((child) => this.node(child, context, level, [], false))
			.join('');
	}

	// ---------- geometry ----------

	private placement(
		node: Exclude<Node, { type: 'PAGE' }>,
		raw: Node,
		parent: ParentContext,
		isRoot: boolean,
		declarations: Declarations
	): void {
		const absolute = !isRoot && (parent.layout === 'NONE' || node.layoutPositioning === 'ABSOLUTE');
		if (absolute) {
			const { x, y } = translation(node.transform);
			declarations.push(['position', 'absolute'], ['left', px(x)], ['top', px(y)]);
		}
		const degrees = rotation(node.transform);
		if (Math.abs(degrees) > 0.01) declarations.push(['transform', `rotate(${number(degrees)}deg)`]);
		const inFlow = !isRoot && !absolute;
		const horizontal = parent.layout === 'HORIZONTAL';
		this.axis(node, raw, 'width', inFlow, horizontal, declarations);
		this.axis(node, raw, 'height', inFlow, parent.layout === 'VERTICAL', declarations);
		const limits: [string, number | null][] = [
			['min-width', node.minWidth],
			['max-width', node.maxWidth],
			['min-height', node.minHeight],
			['max-height', node.maxHeight]
		];
		for (const [property, value] of limits) {
			if (value !== null) declarations.push([property, px(value)]);
		}
	}

	private axis(
		node: Exclude<Node, { type: 'PAGE' }>,
		raw: Node,
		axis: 'width' | 'height',
		inFlow: boolean,
		mainAxis: boolean,
		declarations: Declarations
	): void {
		let sizing = axis === 'width' ? node.layoutSizingHorizontal : node.layoutSizingVertical;
		if (node.type === 'TEXT') sizing = textSizing(node, axis);
		if (sizing === 'FILL' && inFlow) {
			if (mainAxis) declarations.push(['flex', '1 1 0']);
			else declarations.push(['align-self', 'stretch']);
			return;
		}
		if (sizing === 'HUG') {
			// A hugging root would otherwise stretch to the page it is laid out in.
			if (axis === 'width' && !inFlow && !mainAxis) declarations.push(['width', 'fit-content']);
			return;
		}
		declarations.push([axis, this.bound(raw, axis) ?? px(node[axis])]);
	}

	// ---------- frames ----------

	private box(node: Exclude<Node, { type: 'PAGE' }>, raw: Node, declarations: Declarations): void {
		if ('fills' in node)
			this.fills(node.fills, raw, node.width, node.height, declarations, 'background');
		if ('strokes' in node) this.strokes(node.strokes, declarations);
		this.corners(node, raw, declarations);
		if ('clipsContent' in node && node.clipsContent) declarations.push(['overflow', 'hidden']);
	}

	private corners(node: Node, raw: Node, declarations: Declarations): void {
		if (node.type === 'ELLIPSE') {
			declarations.push(['border-radius', '50%']);
			return;
		}
		if (!('cornerRadius' in node)) return;
		const radius = node.cornerRadius;
		if (typeof radius !== 'number') {
			declarations.push(['border-radius', radius.map(px).join(' ')]);
			return;
		}
		if (radius > 0)
			declarations.push(['border-radius', this.bound(raw, 'cornerRadius') ?? px(radius)]);
	}

	private layout(node: Node, raw: Node, declarations: Declarations): ParentContext['layout'] {
		if (!('layoutMode' in node)) {
			if (this.source.children(node.id).length > 0) declarations.push(['position', 'relative']);
			return 'NONE';
		}
		const mode = node.layoutMode;
		if (mode === 'NONE' || mode === 'GRID') {
			if (this.source.children(node.id).length > 0) declarations.push(['position', 'relative']);
			return mode;
		}
		declarations.push(['display', 'flex']);
		if (mode === 'VERTICAL') declarations.push(['flex-direction', 'column']);
		if (node.layoutWrap === 'WRAP') declarations.push(['flex-wrap', 'wrap']);
		if (node.itemSpacing !== 0 || raw.boundVariables?.itemSpacing !== undefined) {
			const gap = this.bound(raw, 'itemSpacing') ?? px(node.itemSpacing);
			if (node.layoutWrap === 'WRAP' && node.counterAxisSpacing !== null) {
				declarations.push(['gap', `${px(node.counterAxisSpacing)} ${gap}`]);
			} else declarations.push(['gap', gap]);
		}
		const padding = [
			this.bound(raw, 'paddingTop') ?? px(node.paddingTop),
			this.bound(raw, 'paddingRight') ?? px(node.paddingRight),
			this.bound(raw, 'paddingBottom') ?? px(node.paddingBottom),
			this.bound(raw, 'paddingLeft') ?? px(node.paddingLeft)
		];
		if (padding.some((value) => value !== '0'))
			declarations.push(['padding', compactSides(padding)]);
		const justify = JUSTIFY[node.primaryAxisAlignItems];
		if (justify !== undefined && justify !== 'flex-start')
			declarations.push(['justify-content', justify]);
		declarations.push(['align-items', ALIGN[node.counterAxisAlignItems] ?? 'flex-start']);
		return mode;
	}

	// ---------- paint ----------

	private fills(
		fills: readonly Paint[],
		raw: Node,
		width: number,
		height: number,
		declarations: Declarations,
		target: 'background' | 'color'
	): void {
		const visible = fills.filter((paint) => paint.visible);
		let rawFills: typeof fills = [];
		if ('fills' in raw) rawFills = raw.fills;
		const solids = visible.filter((paint) => paint.type === 'SOLID');
		const layers: string[] = [];
		for (const paint of [...visible].reverse()) {
			if (paint.type === 'GRADIENT_LINEAR') layers.push(linearGradient(paint, width, height));
			else if (
				paint.type === 'GRADIENT_RADIAL' ||
				paint.type === 'GRADIENT_ANGULAR' ||
				paint.type === 'GRADIENT_DIAMOND'
			) {
				layers.push(`radial-gradient(${stopList(paint.gradientStops)})`);
			} else if (paint.type === 'IMAGE') layers.push(`url(asset:${paint.imageHash})`);
		}
		const solid = solids[solids.length - 1];
		if (target === 'color') {
			if (solid !== undefined && solid.type === 'SOLID') {
				const rawPaint = rawFills[fills.indexOf(solid)];
				declarations.push([
					'color',
					this.variable(aliasId(rawPaint?.boundVariables?.color)) ??
						cssColor(solid.color, solid.opacity)
				]);
			}
			return;
		}
		if (solid !== undefined && solid.type === 'SOLID') {
			const rawPaint = rawFills[fills.indexOf(solid)];
			const value =
				this.variable(aliasId(rawPaint?.boundVariables?.color)) ??
				cssColor(solid.color, solid.opacity);
			declarations.push(['background-color', value]);
		}
		if (layers.length > 0) declarations.push(['background-image', layers.join(', ')]);
	}

	private strokes(strokes: readonly Stroke[], declarations: Declarations): void {
		const stroke = strokes.find((candidate) => candidate.paints.some((paint) => paint.visible));
		if (stroke === undefined) return;
		const paint = stroke.paints.find((candidate) => candidate.visible);
		if (paint === undefined || paint.type !== 'SOLID') return;
		const color = cssColor(paint.color, paint.opacity);
		let style = 'solid';
		if (stroke.dashPattern.length > 0) style = stroke.dashPattern[0] === 0 ? 'dotted' : 'dashed';
		if (typeof stroke.weight === 'number') {
			declarations.push(['border', `${px(stroke.weight)} ${style} ${color}`]);
			return;
		}
		const weights = stroke.weight;
		declarations.push(
			['border-style', style],
			['border-color', color],
			[
				'border-width',
				compactSides([px(weights.top), px(weights.right), px(weights.bottom), px(weights.left)])
			]
		);
	}

	private appearance(node: Exclude<Node, { type: 'PAGE' }>, declarations: Declarations): void {
		if (!node.visible) declarations.push(['display', 'none']);
		if ('opacity' in node && node.opacity < 1) declarations.push(['opacity', number(node.opacity)]);
		if ('blendMode' in node && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') {
			declarations.push(['mix-blend-mode', node.blendMode.toLowerCase().replaceAll('_', '-')]);
		}
		if ('effects' in node) this.effects(node.effects, declarations);
	}

	private effects(effects: readonly Effect[], declarations: Declarations): void {
		const shadows: string[] = [];
		for (const effect of effects) {
			if (!effect.visible) continue;
			if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
				const parts = [
					px(effect.offset.x),
					px(effect.offset.y),
					px(effect.radius),
					px(effect.spread),
					cssColor(effect.color, effect.color.a)
				];
				if (effect.type === 'INNER_SHADOW') parts.push('inset');
				shadows.push(parts.join(' '));
			}
			if (effect.type === 'LAYER_BLUR') declarations.push(['filter', `blur(${px(effect.radius)})`]);
			if (effect.type === 'BACKGROUND_BLUR')
				declarations.push(['backdrop-filter', `blur(${px(effect.radius)})`]);
		}
		if (shadows.length > 0) declarations.push(['box-shadow', shadows.join(', ')]);
	}

	// ---------- text ----------

	private textStyle(node: TextNode, raw: Node, declarations: Declarations): void {
		declarations.push(...fontDeclarations(node.defaultStyle));
		const align = node.paragraphs[0]?.align ?? 'LEFT';
		if (align !== 'LEFT') declarations.push(['text-align', TEXT_ALIGN[align]]);
		if (node.textAutoResize === 'WIDTH_AND_HEIGHT') declarations.push(['white-space', 'nowrap']);
		const fills = node.defaultStyle.fills.length > 0 ? node.defaultStyle.fills : node.fills;
		const rawStyle = raw.type === 'TEXT' ? raw.defaultStyle : undefined;
		const solid = fills.find((paint) => paint.visible && paint.type === 'SOLID');
		if (solid === undefined || solid.type !== 'SOLID') return;
		const rawPaint = rawStyle?.fills[fills.indexOf(solid)];
		declarations.push([
			'color',
			this.variable(aliasId(rawPaint?.boundVariables?.color)) ??
				cssColor(solid.color, solid.opacity)
		]);
	}

	private paragraphs(node: TextNode): string {
		return node.paragraphs
			.map((paragraph) =>
				paragraph.runs
					.map((run) => {
						const text = escapeText(run.text);
						const delta = runDeclarations(run.style);
						if (delta.length === 0) return text;
						return `<span${styleAttribute(delta)}>${text}</span>`;
					})
					.join('')
			)
			.join('<br>');
	}
}

function aliasId(binding: BoundVariables[string] | undefined): string | undefined {
	if (binding === undefined || Array.isArray(binding)) return undefined;
	return binding.id;
}

function compactSides(sides: string[]): string {
	const [top, right, bottom, left] = sides;
	if (top === right && top === bottom && top === left) return top;
	if (top === bottom && right === left) return `${top} ${right}`;
	return sides.join(' ');
}

function textSizing(node: TextNode, axis: 'width' | 'height'): 'FIXED' | 'HUG' | 'FILL' {
	const sizing = axis === 'width' ? node.layoutSizingHorizontal : node.layoutSizingVertical;
	if (sizing === 'FILL') return 'FILL';
	if (axis === 'width' && node.textAutoResize === 'WIDTH_AND_HEIGHT') return 'HUG';
	if (axis === 'height' && node.textAutoResize !== 'NONE') return 'HUG';
	return 'FIXED';
}

function fontDeclarations(style: Partial<TextStyle>): Declarations {
	const declarations: Declarations = [];
	if (style.fontName !== undefined) {
		declarations.push(['font-family', `'${style.fontName.family}'`]);
		if (isItalic(style.fontName.style)) declarations.push(['font-style', 'italic']);
	}
	if (style.fontWeight !== undefined && style.fontWeight !== 400) {
		declarations.push(['font-weight', String(style.fontWeight)]);
	}
	if (style.fontSize !== undefined) declarations.push(['font-size', px(style.fontSize)]);
	const lineHeight = style.lineHeight;
	if (lineHeight !== undefined && lineHeight.unit !== 'AUTO') {
		const value =
			lineHeight.unit === 'PIXELS' ? px(lineHeight.value) : `${number(lineHeight.value)}%`;
		declarations.push(['line-height', value]);
	}
	const spacing = style.letterSpacing;
	if (spacing !== undefined && spacing.value !== 0) {
		const value =
			spacing.unit === 'PIXELS' ? px(spacing.value) : `${number(spacing.value / 100)}em`;
		declarations.push(['letter-spacing', value]);
	}
	const textCase = style.textCase === undefined ? undefined : TEXT_CASE[style.textCase];
	if (textCase !== undefined) declarations.push(['text-transform', textCase]);
	const decoration =
		style.textDecoration === undefined ? undefined : DECORATION[style.textDecoration];
	if (decoration !== undefined) declarations.push(['text-decoration', decoration]);
	return declarations;
}

function runDeclarations(style: Partial<TextStyle>): Declarations {
	const declarations = fontDeclarations(style);
	const solid = style.fills?.find((paint) => paint.visible && paint.type === 'SOLID');
	if (solid !== undefined && solid.type === 'SOLID')
		declarations.push(['color', cssColor(solid.color, solid.opacity)]);
	return declarations;
}

function stopList(
	stops: readonly { position: number; color: { r: number; g: number; b: number; a: number } }[]
): string {
	return stops
		.map((stop) => `${cssColor(stop.color, stop.color.a)} ${number(stop.position * 100)}%`)
		.join(', ');
}

/** The CSS angle of a linear gradient paint: where its (0, .5) -> (1, .5) line runs in the box. */
function linearGradient(paint: GradientPaint, width: number, height: number): string {
	const toBox = invertMatrix(paint.gradientTransform);
	if (toBox === null) return `linear-gradient(${stopList(paint.gradientStops)})`;
	const point = (x: number, y: number): { x: number; y: number } => ({
		x: (toBox[0][0] * x + toBox[0][1] * y + toBox[0][2]) * width,
		y: (toBox[1][0] * x + toBox[1][1] * y + toBox[1][2]) * height
	});
	const start = point(0, 0.5);
	const end = point(1, 0.5);
	const degrees = (Math.atan2(end.x - start.x, -(end.y - start.y)) * 180) / Math.PI;
	return `linear-gradient(${number((degrees + 360) % 360)}deg, ${stopList(paint.gradientStops)})`;
}

/** HTML for `ids` (and what is below them), in document order. */
export function serializeHtml(
	source: TreeSource,
	ids: readonly NodeId[],
	options: HtmlSerializeOptions = {}
): string {
	const writer = new HtmlWriter(source, options);
	return ids.map((id) => writer.root(id)).join('\n');
}
