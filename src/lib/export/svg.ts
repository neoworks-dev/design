// SVG serializer (#127): the scene (variable-resolved nodes from a SceneSource) as SVG markup.
// Pure and independent of CanvasKit: shapes come from `nodeOutline`, the same geometry the
// renderer draws. Decision of the spike (docs/research/rendering.md section 4): the stock
// canvaskit-wasm build has no SVG canvas, so this is our own serializer over the scene.
//
// Covered: rectangles, ellipses, lines, polygons, stars, vectors (incl. region fills), frames with
// corner radii and clipping, groups, solid, linear and radial gradient fills, strokes (weight,
// inside/outside/center alignment, caps, joins, dashes), opacity, blend modes, masks, drop shadows
// and layer blur, text as `<text>` (no wrapping), boolean operations (through `booleanPathData`).
// Not covered, and listed in `warnings`: image fills, inner shadows, background blur,
// angular/diamond gradients (drawn radial), per-side stroke weights (uses the widest).

import { nodeOutline, type Outline, type PathCommand } from '../document/outline';
import { resolveStyle } from '../document/text';
import type {
	Matrix2x3,
	NodeId,
	Paint,
	Rect,
	RGBA,
	SceneNode,
	Stroke,
	TextNode,
	TextStyle
} from '../document/types';
import type { SceneSource } from '../renderer/sceneSource';
import {
	SvgDefs,
	colorHex,
	cssBlendMode,
	effectsFilter,
	escapeXml,
	formatNumber,
	isIdentity,
	matrixAttribute,
	paintAttributes,
	pathData,
	strokeStyleAttributes
} from './svgPaint';

export interface SvgGeometry {
	absoluteTransform(id: NodeId): Matrix2x3;
}

export interface SvgOptions {
	/** The page-space area to export; the SVG's viewBox. */
	area: Rect;
	/** Output size is the area times this (a vector format: only the width/height attributes). */
	scale: number;
	/** Only the node and its subtree (default true); otherwise the whole page under the area. */
	contentsOnly?: boolean;
	/** Put the node id on every element, so an import or script can find them (default true). */
	includeIds?: boolean;
	background?: RGBA;
	/** The result path of a boolean operation as SVG path data (needs Skia, so injected). */
	booleanPathData?: (node: SceneNode) => string | null;
}

export interface SvgResult {
	svg: string;
	width: number;
	height: number;
	warnings: string[];
}

export function serializeSvg(
	source: SceneSource,
	geometry: SvgGeometry,
	id: NodeId,
	options: SvgOptions
): SvgResult {
	const writer = new SvgWriter(source, options);
	const body = writer.exportBody(geometry, id);
	const { area } = options;
	const width = Math.max(1, Math.ceil(area.width * options.scale - 1e-6));
	const height = Math.max(1, Math.ceil(area.height * options.scale - 1e-6));
	const viewBox = [area.x, area.y, area.width, area.height].map(formatNumber).join(' ');
	let background = '';
	if (options.background !== undefined) {
		background = `<rect x="${formatNumber(area.x)}" y="${formatNumber(area.y)}" width="${formatNumber(area.width)}" height="${formatNumber(area.height)}" fill="${colorHex(options.background)}" fill-opacity="${formatNumber(options.background.a)}"/>`;
	}
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="none">` +
		`${writer.defs.markup()}${background}${body}</svg>`;
	return { svg, width, height, warnings: [...writer.defs.warnings] };
}

class SvgWriter {
	readonly defs = new SvgDefs();

	constructor(
		private readonly source: SceneSource,
		private readonly options: SvgOptions
	) {}

	exportBody(geometry: SvgGeometry, id: NodeId): string {
		if (this.options.contentsOnly === false) return this.page(id);
		const node = this.source.getNode(id);
		if (!node) return '';
		const inner = this.node(id);
		if (node.parentId === null) return inner;
		const parent = geometry.absoluteTransform(node.parentId);
		if (isIdentity(parent)) return inner;
		return `<g transform="${matrixAttribute(parent)}">${inner}</g>`;
	}

	private page(id: NodeId): string {
		let current = this.source.getNode(id);
		while (current && current.type !== 'PAGE' && current.parentId !== null) {
			current = this.source.getNode(current.parentId);
		}
		if (!current) return '';
		return this.siblings(this.source.children(current.id));
	}

	/** Siblings bottom to top; a visible mask node masks everything above it. */
	private siblings(ids: readonly NodeId[]): string {
		let markup = '';
		for (let index = 0; index < ids.length; index += 1) {
			const mask = this.visibleNode(ids[index]);
			if (mask === null || !('isMask' in mask) || !mask.isMask) {
				markup += this.node(ids[index]);
				continue;
			}
			const maskId = this.maskDefinition(mask);
			const masked = this.siblings(ids.slice(index + 1));
			return `${markup}<g mask="url(#${maskId})">${masked}</g>`;
		}
		return markup;
	}

	private visibleNode(id: NodeId): SceneNode | null {
		const stored = this.source.getNode(id);
		if (!stored || stored.type === 'PAGE') return null;
		const node = this.source.resolve(stored);
		if (node.type === 'SLICE' || !node.visible) return null;
		return node;
	}

	private maskDefinition(mask: SceneNode): string {
		const id = this.defs.nextId('mask');
		let content = this.node(mask.id, true);
		if ('maskType' in mask && mask.maskType === 'LUMINANCE') content = this.node(mask.id);
		this.defs.add(
			`<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style="mask-type:${this.maskKind(mask)}">${content}</mask>`
		);
		return id;
	}

	private maskKind(mask: SceneNode): string {
		if ('maskType' in mask && mask.maskType === 'LUMINANCE') return 'luminance';
		return 'alpha';
	}

	private idAttribute(id: NodeId): string {
		if (this.options.includeIds === false) return '';
		return ` id="${escapeXml(id)}"`;
	}

	/** One node and its subtree. `asMask` draws it in plain white (the shape of an alpha mask). */
	private node(id: NodeId, asMask = false): string {
		const node = this.visibleNode(id);
		if (node === null) return '';
		const attributes = [this.idAttribute(id).trim()];
		if (!isIdentity(node.transform))
			attributes.push(`transform="${matrixAttribute(node.transform)}"`);
		attributes.push(...this.layerAttributes(node));
		const content = this.ownContent(node, asMask) + this.childContent(node, asMask);
		return `<g ${attributes.filter((entry) => entry !== '').join(' ')}>${content}</g>`;
	}

	private layerAttributes(node: SceneNode): string[] {
		const attributes: string[] = [];
		if (!('opacity' in node)) return attributes;
		if (node.opacity < 1) attributes.push(`opacity="${formatNumber(node.opacity)}"`);
		const blend = cssBlendMode(node.blendMode);
		if (blend !== null) attributes.push(`style="mix-blend-mode:${blend}"`);
		const filter = effectsFilter(node.effects, this.defs);
		if (filter !== null) attributes.push(`filter="url(#${filter})"`);
		return attributes;
	}

	private outlineOf(node: SceneNode): Outline | null {
		if (node.type === 'BOOLEAN_OPERATION') return this.booleanOutline(node);
		return nodeOutline(node);
	}

	private booleanOutline(node: SceneNode): Outline | null {
		const data = this.options.booleanPathData;
		if (data === undefined) return null;
		const result = data(node);
		if (result === null) return null;
		this.booleanData.set(node.id, result);
		return { fill: [], stroke: [], closed: true, fillRule: 'NONZERO' };
	}

	private readonly booleanData = new Map<NodeId, string>();

	private shapePath(node: SceneNode, commands: readonly PathCommand[]): string {
		const known = this.booleanData.get(node.id);
		if (known !== undefined) return known;
		return pathData(commands);
	}

	private ownContent(node: SceneNode, asMask: boolean): string {
		if (node.type === 'TEXT') return this.text(node, asMask);
		const outline = this.outlineOf(node);
		if (outline === null || !('fills' in node)) return '';
		const size = { width: node.width, height: node.height };
		if (asMask) return this.maskShape(node, outline);
		let markup = this.fills(node, node.fills, outline.fill, outline.fillRule, size);
		for (const region of outline.regionFills ?? []) {
			markup += this.fills(node, region.fills, region.commands, region.fillRule, size);
		}
		for (const stroke of node.strokes) markup += this.stroke(node, stroke, outline, size);
		return markup;
	}

	private maskShape(node: SceneNode, outline: Outline): string {
		const commands = [...outline.fill, ...outline.stroke];
		const data = this.shapePath(node, outline.fill.length > 0 ? outline.fill : commands);
		if (data === '') return '';
		return `<path d="${data}" fill="#fff"/>`;
	}

	private fills(
		node: SceneNode,
		paints: readonly Paint[],
		commands: readonly PathCommand[],
		fillRule: Outline['fillRule'],
		size: { width: number; height: number }
	): string {
		const data = this.shapePath(node, commands);
		if (data === '') return '';
		let rule = '';
		if (fillRule === 'EVENODD') rule = ' fill-rule="evenodd"';
		let markup = '';
		for (const paint of paints) {
			const attribute = paintAttributes('fill', paint, size, this.defs);
			if (attribute !== null) markup += `<path d="${data}" ${attribute}${rule}/>`;
		}
		return markup;
	}

	private stroke(
		node: SceneNode,
		stroke: Stroke,
		outline: Outline,
		size: { width: number; height: number }
	): string {
		const weight = strokeWeight(stroke, this.defs);
		if (weight <= 0) return '';
		const data = this.shapePath(node, outline.stroke);
		if (data === '') return '';
		let align = stroke.align;
		if (!outline.closed) align = 'CENTER';
		const style = strokeStyleAttributes(stroke);
		let markup = '';
		for (const paint of stroke.paints) {
			const attribute = paintAttributes('stroke', paint, size, this.defs);
			if (attribute === null) continue;
			const width = this.strokeWidth(align, weight);
			const path = `<path d="${data}" ${attribute} stroke-width="${formatNumber(width)}" ${style}`;
			markup += this.aligned(path, align, data, outline);
		}
		return markup;
	}

	private strokeWidth(align: Stroke['align'], weight: number): number {
		if (align === 'CENTER') return weight;
		return weight * 2;
	}

	/** Inside and outside strokes are the double-width stroke clipped to one side of the shape. */
	private aligned(path: string, align: Stroke['align'], data: string, outline: Outline): string {
		if (align === 'CENTER') return `${path}/>`;
		let rule = '';
		if (outline.fillRule === 'EVENODD') rule = ' clip-rule="evenodd"';
		if (align === 'INSIDE') {
			const clip = this.defs.nextId('clip');
			this.defs.add(`<clipPath id="${clip}"><path d="${data}"${rule}/></clipPath>`);
			return `<g clip-path="url(#${clip})">${path}/></g>`;
		}
		const mask = this.defs.nextId('mask');
		const extent = `x="-100000" y="-100000" width="200000" height="200000"`;
		this.defs.add(
			`<mask id="${mask}" maskUnits="userSpaceOnUse" ${extent}><rect ${extent} fill="#fff"/><path d="${data}" fill="#000"${rule}/></mask>`
		);
		return `<g mask="url(#${mask})">${path}/></g>`;
	}

	private childContent(node: SceneNode, asMask: boolean): string {
		if (node.type === 'BOOLEAN_OPERATION') return '';
		if (node.type === 'SECTION' && node.sectionContentsHidden) return '';
		if (asMask && node.type !== 'GROUP') return '';
		const children = this.siblings(this.source.children(node.id));
		if (children === '') return '';
		const clip = this.clipFor(node);
		if (clip === null) return children;
		return `<g clip-path="url(#${clip})">${children}</g>`;
	}

	private clipFor(node: SceneNode): string | null {
		const clips =
			(node.type === 'FRAME' ||
				node.type === 'COMPONENT' ||
				node.type === 'COMPONENT_SET' ||
				node.type === 'INSTANCE') &&
			node.clipsContent;
		if (!clips) return null;
		const outline = nodeOutline(node);
		if (outline === null || outline.fill.length === 0) return null;
		const id = this.defs.nextId('clip');
		this.defs.add(`<clipPath id="${id}"><path d="${pathData(outline.fill)}"/></clipPath>`);
		return id;
	}

	// ---------- text ----------

	private text(node: TextNode, asMask: boolean): string {
		this.defs.warnings.add('text is exported as <text> without line wrapping');
		let top = 0;
		const lines: string[] = [];
		for (const paragraph of node.paragraphs) {
			const first = resolveStyle(node.defaultStyle, paragraph.runs[0]?.style ?? {});
			const height = lineHeightOf(first);
			lines.push(this.paragraph(node, paragraph, top, height, asMask));
			top += height + paragraph.spacingAfter;
		}
		const shift = verticalShift(node, top);
		if (shift === 0) return lines.join('');
		return `<g transform="translate(0 ${formatNumber(shift)})">${lines.join('')}</g>`;
	}

	private paragraph(
		node: TextNode,
		paragraph: TextNode['paragraphs'][number],
		top: number,
		height: number,
		asMask: boolean
	): string {
		const first = resolveStyle(node.defaultStyle, paragraph.runs[0]?.style ?? {});
		const baseline = top + height / 2 + first.fontSize * 0.35;
		const { x, anchor } = alignment(paragraph.align, node.width, paragraph.indent);
		const spans = paragraph.runs.map((run) => this.run(node, run.text, run.style, asMask)).join('');
		return `<text x="${formatNumber(x)}" y="${formatNumber(baseline)}" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`;
	}

	private run(node: TextNode, text: string, delta: Partial<TextStyle>, asMask: boolean): string {
		const style = resolveStyle(node.defaultStyle, delta);
		const fill = this.textFill(node, style, asMask);
		const family = escapeXml(style.fontName.family);
		let attributes = `font-family="${family}" font-size="${formatNumber(style.fontSize)}" font-weight="${style.fontWeight}" ${fill}`;
		if (style.fontName.style.toLowerCase().includes('italic')) attributes += ' font-style="italic"';
		if (style.textDecoration === 'UNDERLINE') attributes += ' text-decoration="underline"';
		if (style.textDecoration === 'STRIKETHROUGH') attributes += ' text-decoration="line-through"';
		return `<tspan ${attributes}>${escapeXml(applyCase(text, style))}</tspan>`;
	}

	private textFill(node: TextNode, style: TextStyle, asMask: boolean): string {
		if (asMask) return 'fill="#fff"';
		const size = { width: node.width, height: node.height };
		for (const paint of style.fills) {
			const attribute = paintAttributes('fill', paint, size, this.defs);
			if (attribute !== null) return attribute;
		}
		return 'fill="none"';
	}
}

function strokeWeight(stroke: Stroke, defs: SvgDefs): number {
	if (typeof stroke.weight === 'number') return stroke.weight;
	const { top, right, bottom, left } = stroke.weight;
	const widest = Math.max(top, right, bottom, left);
	if (!(top === right && right === bottom && bottom === left)) {
		defs.warnings.add('per-side stroke weights are exported with the widest weight');
	}
	return widest;
}

function lineHeightOf(style: TextStyle): number {
	const { lineHeight } = style;
	if (lineHeight.unit === 'PIXELS') return lineHeight.value;
	if (lineHeight.unit === 'PERCENT') return (lineHeight.value / 100) * style.fontSize;
	return style.fontSize * 1.2;
}

function alignment(
	align: TextNode['paragraphs'][number]['align'],
	width: number,
	indent: number
): { x: number; anchor: string } {
	if (align === 'CENTER') return { x: width / 2, anchor: 'middle' };
	if (align === 'RIGHT') return { x: width, anchor: 'end' };
	return { x: indent, anchor: 'start' };
}

function verticalShift(node: TextNode, contentHeight: number): number {
	if (node.textAlignVertical === 'CENTER') return (node.height - contentHeight) / 2;
	if (node.textAlignVertical === 'BOTTOM') return node.height - contentHeight;
	return 0;
}

function applyCase(text: string, style: TextStyle): string {
	if (style.textCase === 'UPPER') return text.toUpperCase();
	if (style.textCase === 'LOWER') return text.toLowerCase();
	return text;
}
