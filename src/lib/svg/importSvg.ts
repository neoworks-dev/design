// SVG markup to document nodes (#106): a FRAME the size of the SVG holding GROUPs and shape nodes.
// Paths, polygons, polylines and lines become VECTORs (vector networks), rectangles and ellipses
// stay RECTANGLEs and ELLIPSEs, `text` becomes TEXT, `use` is expanded. Transforms are baked into
// each shape's own transform, so a group is only a container at its children's bounds. Fills,
// strokes, opacity, linear and radial gradients are carried over; what cannot be (clip paths,
// masks, filters, images, patterns, markers) is dropped and listed in `warnings`.
//
// Pure given a DOM `Document`-like parser (DOMParser): no kernel, no Svelte.

import { generateNodeId, keysBetween } from '../document';
import { createNode } from '../document/defaults';
import type { FillRule, PathCommand } from '../document/outline';
import {
	composeMatrices,
	identityMatrix,
	transformedBounds,
	translationMatrix
} from '../document/matrix';
import type {
	Matrix2x3,
	Node,
	NodeId,
	Paint,
	Paragraph,
	Rect,
	Stroke,
	TextStyle,
	VectorNetwork
} from '../document/types';
import { commandsToNetwork } from '../vector/fromCommands';
import { normalizeNetwork } from '../vector/geometry';
import { parseColor } from './color';
import { tagName } from './dom';
import { gradientPaint, type GradientContext } from './gradients';
import { parsePathData } from './pathData';
import { computedStyle, ownStyle, parseStyleSheet, type CssRule, type StyleMap } from './styles';
import { parseTransform } from './transform';

export interface SvgImportOptions {
	/** Name of the frame; `SVG` when omitted. */
	name?: string;
}

export interface SvgImport {
	/** The frame first, then its descendants, parents before children. */
	nodes: Node[];
	rootId: NodeId;
	width: number;
	height: number;
	/** What was left out or approximated, one line each. */
	warnings: string[];
}

const DEFAULT_SIZE = 100;
const MAX_USE_DEPTH = 16;
const TEXT_ASCENT = 0.9;
const TEXT_WIDTH_PER_EM = 0.55;
const SKIPPED = new Set([
	'defs',
	'title',
	'desc',
	'metadata',
	'style',
	'lineargradient',
	'radialgradient',
	'clippath',
	'mask',
	'marker',
	'symbol',
	'filter',
	'pattern',
	'script'
]);
const UNSUPPORTED_ELEMENTS: Record<string, string> = {
	image: 'images are not imported',
	foreignobject: 'foreignObject is not imported'
};
const LENGTH_UNITS: Record<string, number> = {
	px: 1,
	pt: 4 / 3,
	pc: 16,
	mm: 96 / 25.4,
	cm: 96 / 2.54,
	in: 96,
	em: 16
};

interface ShapeDraft {
	kind: 'shape';
	node: Exclude<Node, { type: 'PAGE' }>;
	bounds: Rect;
}

interface GroupDraft {
	kind: 'group';
	name: string;
	opacity: number;
	children: Draft[];
}

type Draft = ShapeDraft | GroupDraft;

interface Session {
	elements: Map<string, Element>;
	rules: CssRule[];
	warnings: Set<string>;
	gradients: GradientContext;
}

function parseLength(value: string | null, fallback: number): number {
	if (value === null) return fallback;
	const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/.exec(value);
	if (match === null) return fallback;
	const unit = match[2];
	if (unit === '%') return fallback;
	const factor = unit === '' ? 1 : LENGTH_UNITS[unit];
	if (factor === undefined) return fallback;
	return Number(match[1]) * factor;
}

function numberAttribute(element: Element, name: string, fallback = 0): number {
	return parseLength(element.getAttribute(name), fallback);
}

// ---------- document level ----------

function indexElements(root: Element): Map<string, Element> {
	const elements = new Map<string, Element>();
	const visit = (element: Element): void => {
		const id = element.getAttribute('id');
		if (id !== null && !elements.has(id)) elements.set(id, element);
		for (const child of Array.from(element.children)) visit(child);
	};
	visit(root);
	return elements;
}

function collectStyleSheets(root: Element): CssRule[] {
	const rules: CssRule[] = [];
	for (const sheet of Array.from(root.getElementsByTagName('style'))) {
		rules.push(...parseStyleSheet(sheet.textContent ?? ''));
	}
	return rules;
}

interface Viewport {
	width: number;
	height: number;
	/** Maps SVG user space (viewBox) onto the frame. */
	matrix: Matrix2x3;
}

function viewportOf(root: Element): Viewport {
	const viewBox = (root.getAttribute('viewBox') ?? '')
		.split(/[\s,]+/)
		.filter((part) => part !== '')
		.map(Number);
	const hasBox =
		viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
	let width = parseLength(root.getAttribute('width'), 0);
	let height = parseLength(root.getAttribute('height'), 0);
	if (!hasBox) {
		if (width <= 0) width = DEFAULT_SIZE;
		if (height <= 0) height = DEFAULT_SIZE;
		return { width, height, matrix: identityMatrix() };
	}
	const [boxX, boxY, boxWidth, boxHeight] = viewBox;
	if (width <= 0 && height <= 0) {
		width = boxWidth;
		height = boxHeight;
	} else if (width <= 0) {
		width = (height / boxHeight) * boxWidth;
	} else if (height <= 0) {
		height = (width / boxWidth) * boxHeight;
	}
	// preserveAspectRatio defaults to xMidYMid meet
	const scale = Math.min(width / boxWidth, height / boxHeight);
	return {
		width,
		height,
		matrix: [
			[scale, 0, (width - boxWidth * scale) / 2 - boxX * scale],
			[0, scale, (height - boxHeight * scale) / 2 - boxY * scale]
		]
	};
}

// ---------- paints ----------

function resolveColor(value: string, style: StyleMap): ReturnType<typeof parseColor> {
	if (value.trim().toLowerCase() === 'currentcolor') {
		return parseColor(style.color ?? 'black');
	}
	return parseColor(value);
}

function paintOf(
	value: string | undefined,
	opacityValue: string | undefined,
	style: StyleMap,
	box: Rect,
	session: Session,
	fallback: string
): Paint | null {
	const text = value === undefined ? fallback : value.trim();
	if (text === 'none') return null;
	const opacity = Math.min(1, Math.max(0, Number.parseFloat(opacityValue ?? '1')));
	const factor = Number.isFinite(opacity) ? opacity : 1;
	const reference = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(text);
	if (reference !== null) {
		const definition = session.elements.get(reference[1]);
		const isGradient =
			definition !== undefined &&
			(tagName(definition) === 'lineargradient' || tagName(definition) === 'radialgradient');
		if (!isGradient) {
			session.warnings.add(`paint server #${reference[1]} is not a gradient and was ignored`);
			return null;
		}
		return gradientPaint(definition, box, factor, session.gradients);
	}
	const color = resolveColor(text, style);
	if (color === null) {
		session.warnings.add(`colour "${text}" is not understood and was ignored`);
		return null;
	}
	return {
		type: 'SOLID',
		visible: true,
		opacity: factor * color.a,
		blendMode: 'NORMAL',
		color: { r: color.r, g: color.g, b: color.b }
	};
}

function capOf(value: string | undefined): Stroke['cap'] {
	if (value === 'round') return 'ROUND';
	if (value === 'square') return 'SQUARE';
	return 'NONE';
}

function joinOf(value: string | undefined): Stroke['join'] {
	if (value === 'round') return 'ROUND';
	if (value === 'bevel') return 'BEVEL';
	return 'MITER';
}

function strokeOf(style: StyleMap, box: Rect, session: Session): Stroke | null {
	const paint = paintOf(style.stroke, style['stroke-opacity'], style, box, session, 'none');
	if (paint === null) return null;
	const weight = parseLength(style['stroke-width'] ?? null, 1);
	if (weight <= 0) return null;
	const cap = style['stroke-linecap'];
	const join = style['stroke-linejoin'];
	const dashes = (style['stroke-dasharray'] ?? '')
		.split(/[\s,]+/)
		.filter((part) => part !== '' && part !== 'none')
		.map(Number)
		.filter((value) => Number.isFinite(value) && value >= 0);
	return {
		paints: [paint],
		weight,
		align: 'CENTER',
		cap: capOf(cap),
		join: joinOf(join),
		miterLimit: Number.parseFloat(style['stroke-miterlimit'] ?? '4') || 4,
		dashPattern: dashes
	};
}

interface Painted {
	fills: Paint[];
	strokes: Stroke[];
}

function paintedWith(style: StyleMap, box: Rect, session: Session): Painted {
	const fill = paintOf(style.fill, style['fill-opacity'], style, box, session, 'black');
	const stroke = strokeOf(style, box, session);
	const painted: Painted = { fills: [], strokes: [] };
	if (fill !== null) painted.fills.push(fill);
	if (stroke !== null) painted.strokes.push(stroke);
	return painted;
}

function alignOf(anchor: string | undefined): Paragraph['align'] {
	if (anchor === 'middle') return 'CENTER';
	if (anchor === 'end') return 'RIGHT';
	return 'LEFT';
}

// ---------- shapes ----------

function nameOf(element: Element, fallback: string): string {
	const id = element.getAttribute('id');
	if (id !== null && id !== '') return id;
	return fallback;
}

function opacityOf(style: StyleMap): number {
	const value = Number.parseFloat(style.opacity ?? '1');
	if (!Number.isFinite(value)) return 1;
	return Math.min(1, Math.max(0, value));
}

function shapeDraft(node: Exclude<Node, { type: 'PAGE' }>): ShapeDraft {
	return {
		kind: 'shape',
		node,
		bounds: transformedBounds(node.transform, node.width, node.height)
	};
}

function boxShape(
	element: Element,
	type: 'RECTANGLE' | 'ELLIPSE',
	local: Rect,
	matrix: Matrix2x3,
	style: StyleMap,
	session: Session,
	fallbackName: string
): ShapeDraft | null {
	const painted = paintedWith(style, local, session);
	const node = createNode(type, {
		id: generateNodeId(),
		name: nameOf(element, fallbackName),
		transform: composeMatrices(matrix, translationMatrix(local.x, local.y)),
		width: local.width,
		height: local.height,
		fills: painted.fills,
		strokes: painted.strokes,
		opacity: opacityOf(style),
		blendMode: 'PASS_THROUGH'
	});
	return shapeDraft(node);
}

function rectangle(
	element: Element,
	matrix: Matrix2x3,
	style: StyleMap,
	session: Session
): ShapeDraft | null {
	const width = numberAttribute(element, 'width');
	const height = numberAttribute(element, 'height');
	if (width <= 0 || height <= 0) return null;
	const local = {
		x: numberAttribute(element, 'x'),
		y: numberAttribute(element, 'y'),
		width,
		height
	};
	const draft = boxShape(element, 'RECTANGLE', local, matrix, style, session, 'Rectangle');
	if (!draft || draft.node.type !== 'RECTANGLE') return draft;
	let radius = numberAttribute(element, 'rx', numberAttribute(element, 'ry'));
	radius = Math.min(radius, width / 2, height / 2);
	draft.node = { ...draft.node, cornerRadius: radius };
	return draft;
}

function ellipse(
	element: Element,
	matrix: Matrix2x3,
	style: StyleMap,
	session: Session
): ShapeDraft | null {
	const circle = tagName(element) === 'circle';
	const radiusX = circle ? numberAttribute(element, 'r') : numberAttribute(element, 'rx');
	const radiusY = circle ? radiusX : numberAttribute(element, 'ry');
	if (radiusX <= 0 || radiusY <= 0) return null;
	const centerX = numberAttribute(element, 'cx');
	const centerY = numberAttribute(element, 'cy');
	const local = {
		x: centerX - radiusX,
		y: centerY - radiusY,
		width: radiusX * 2,
		height: radiusY * 2
	};
	return boxShape(element, 'ELLIPSE', local, matrix, style, session, circle ? 'Circle' : 'Ellipse');
}

function pointsOf(source: string | null): PathCommand[] {
	const numbers = (source ?? '')
		.split(/[\s,]+/)
		.filter((part) => part !== '')
		.map(Number);
	const commands: PathCommand[] = [];
	for (let index = 0; index + 1 < numbers.length; index += 2) {
		const [x, y] = [numbers[index], numbers[index + 1]];
		if (!Number.isFinite(x) || !Number.isFinite(y)) break;
		commands.push(index === 0 ? { op: 'move', x, y } : { op: 'line', x, y });
	}
	return commands;
}

/** A filled subpath that was not closed is closed, as SVG fills it. */
function closeOpenSubpaths(commands: readonly PathCommand[]): PathCommand[] {
	const closed: PathCommand[] = [];
	let open = false;
	for (const command of commands) {
		if (command.op === 'move' && open) closed.push({ op: 'close' });
		if (command.op === 'close') open = false;
		else open = true;
		closed.push(command);
	}
	if (open) closed.push({ op: 'close' });
	return closed;
}

function commandsFor(element: Element): PathCommand[] {
	switch (tagName(element)) {
		case 'path':
			return parsePathData(element.getAttribute('d') ?? '');
		case 'line':
			return [
				{ op: 'move', x: numberAttribute(element, 'x1'), y: numberAttribute(element, 'y1') },
				{ op: 'line', x: numberAttribute(element, 'x2'), y: numberAttribute(element, 'y2') }
			];
		case 'polygon':
			return [...pointsOf(element.getAttribute('points')), { op: 'close' }];
		default:
			return pointsOf(element.getAttribute('points'));
	}
}

function pathShape(
	element: Element,
	matrix: Matrix2x3,
	style: StyleMap,
	session: Session
): ShapeDraft | null {
	let commands = commandsFor(element);
	if (commands.length < 2) return null;
	const filled = style.fill !== 'none';
	if (filled && tagName(element) !== 'line') commands = closeOpenSubpaths(commands);
	const rule: FillRule = style['fill-rule'] === 'evenodd' ? 'EVENODD' : 'NONZERO';
	const network: VectorNetwork = commandsToNetwork(commands, rule);
	if (network.vertices.length === 0) return null;
	const normalized = normalizeNetwork(network);
	const local = {
		x: normalized.origin.x,
		y: normalized.origin.y,
		width: normalized.width,
		height: normalized.height
	};
	const painted = paintedWith(style, local, session);
	const names: Record<string, string> = {
		path: 'Path',
		line: 'Line',
		polygon: 'Polygon',
		polyline: 'Polyline'
	};
	const node = createNode('VECTOR', {
		id: generateNodeId(),
		name: nameOf(element, names[tagName(element)] ?? 'Vector'),
		transform: composeMatrices(matrix, translationMatrix(normalized.origin.x, normalized.origin.y)),
		width: normalized.width,
		height: normalized.height,
		network: normalized.network,
		fills: painted.fills,
		strokes: painted.strokes,
		opacity: opacityOf(style),
		blendMode: 'PASS_THROUGH'
	});
	return shapeDraft(node);
}

// ---------- text ----------

interface TextLine {
	text: string;
}

function textLines(element: Element): { lines: TextLine[]; x: number; y: number } {
	const lines: TextLine[] = [{ text: '' }];
	let x = numberAttribute(element, 'x');
	let y = numberAttribute(element, 'y');
	let first = true;
	const append = (text: string): void => {
		lines[lines.length - 1].text += text.replace(/\s+/g, ' ');
	};
	for (const child of Array.from(element.childNodes)) {
		if (child.nodeType === 3) {
			append(child.textContent ?? '');
			continue;
		}
		if (!(child instanceof Element)) continue;
		const breaksLine =
			child.hasAttribute('x') || child.hasAttribute('y') || child.hasAttribute('dy');
		if (breaksLine && lines[lines.length - 1].text.trim() !== '') lines.push({ text: '' });
		if (first && breaksLine && lines[0].text.trim() === '') {
			x = numberAttribute(child, 'x', x);
			y = numberAttribute(child, 'y', y);
		}
		first = false;
		append(child.textContent ?? '');
	}
	return {
		lines: lines.map((line) => ({ text: line.text.trim() })).filter((line) => line.text !== ''),
		x,
		y
	};
}

function textStyleOf(style: StyleMap, fills: Paint[], fontSize: number): Partial<TextStyle> {
	const family = (style['font-family'] ?? '').split(',')[0].replace(/['"]/g, '').trim();
	const weight = style['font-weight'] ?? '400';
	const bold = weight === 'bold' || weight === 'bolder' || Number.parseInt(weight, 10) >= 600;
	const result: Partial<TextStyle> = {
		fontSize,
		fontWeight: bold ? 700 : 400,
		fills
	};
	if (family !== '') result.fontName = { family, style: bold ? 'Bold' : 'Regular' };
	return result;
}

function textShape(
	element: Element,
	matrix: Matrix2x3,
	style: StyleMap,
	session: Session
): ShapeDraft | null {
	const { lines, x, y } = textLines(element);
	if (lines.length === 0) return null;
	const fontSize = parseLength(style['font-size'] ?? null, 16);
	const longest = Math.max(...lines.map((line) => line.text.length));
	const width = Math.max(1, longest * fontSize * TEXT_WIDTH_PER_EM);
	const height = lines.length * fontSize * 1.2;
	let left = x;
	if (style['text-anchor'] === 'middle') left -= width / 2;
	if (style['text-anchor'] === 'end') left -= width;
	const box = { x: left, y: y - fontSize * TEXT_ASCENT, width, height };
	const painted = paintedWith(style, box, session);
	const base = createNode('TEXT', {});
	if (base.type !== 'TEXT') return null;
	const textStyle = textStyleOf(style, painted.fills, fontSize);
	const node = createNode('TEXT', {
		id: generateNodeId(),
		name: nameOf(element, lines[0].text.slice(0, 40)),
		transform: composeMatrices(matrix, translationMatrix(box.x, box.y)),
		width,
		height,
		strokes: painted.strokes,
		opacity: opacityOf(style),
		blendMode: 'PASS_THROUGH',
		defaultStyle: { ...base.defaultStyle, ...textStyle },
		paragraphs: lines.map((line) => ({
			runs: [{ text: line.text, style: {} }],
			align: alignOf(style['text-anchor']),
			indent: 0,
			spacingAfter: 0,
			list: 'NONE',
			listLevel: 0
		}))
	});
	return shapeDraft(node);
}

// ---------- the tree ----------

function warnAboutEffects(style: StyleMap, session: Session): void {
	for (const property of ['clip-path', 'mask', 'filter']) {
		const value = style[property];
		if (value !== undefined && value !== 'none')
			session.warnings.add(`${property} is not imported`);
	}
}

function convertChildren(
	parent: Element,
	matrix: Matrix2x3,
	inherited: StyleMap,
	session: Session,
	depth: number
): Draft[] {
	const drafts: Draft[] = [];
	for (const child of Array.from(parent.children)) {
		drafts.push(...convert(child, matrix, inherited, session, depth));
	}
	return drafts;
}

function convertUse(
	element: Element,
	matrix: Matrix2x3,
	style: StyleMap,
	session: Session,
	depth: number
): Draft[] {
	const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
	if (href === null || !href.startsWith('#')) return [];
	const target = session.elements.get(href.slice(1));
	if (!target || depth >= MAX_USE_DEPTH) return [];
	const placed = composeMatrices(
		matrix,
		translationMatrix(numberAttribute(element, 'x'), numberAttribute(element, 'y'))
	);
	if (tagName(target) === 'symbol' || tagName(target) === 'svg') {
		const children = convertChildren(target, placed, style, session, depth + 1);
		return groupOf(children, nameOf(element, 'Use'), style);
	}
	return convert(target, placed, style, session, depth + 1);
}

function groupOf(children: Draft[], name: string, style: StyleMap): Draft[] {
	if (children.length === 0) return [];
	return [{ kind: 'group', name, opacity: opacityOf(style), children }];
}

function convert(
	element: Element,
	parentMatrix: Matrix2x3,
	inherited: StyleMap,
	session: Session,
	depth: number
): Draft[] {
	const tag = tagName(element);
	if (SKIPPED.has(tag)) return [];
	const unsupported = UNSUPPORTED_ELEMENTS[tag];
	if (unsupported !== undefined) {
		session.warnings.add(unsupported);
		return [];
	}
	const style = computedStyle(inherited, ownStyle(element, session.rules));
	if (style.display === 'none' || style.visibility === 'hidden') return [];
	warnAboutEffects(style, session);
	const matrix = composeMatrices(parentMatrix, parseTransform(element.getAttribute('transform')));
	if (tag === 'g' || tag === 'a' || tag === 'svg' || tag === 'switch') {
		return groupOf(
			convertChildren(element, matrix, style, session, depth),
			nameOf(element, 'Group'),
			style
		);
	}
	if (tag === 'use') return convertUse(element, matrix, style, session, depth);
	let draft: ShapeDraft | null = null;
	if (tag === 'rect') draft = rectangle(element, matrix, style, session);
	else if (tag === 'circle' || tag === 'ellipse') draft = ellipse(element, matrix, style, session);
	else if (['path', 'line', 'polygon', 'polyline'].includes(tag)) {
		draft = pathShape(element, matrix, style, session);
	} else if (tag === 'text') draft = textShape(element, matrix, style, session);
	else session.warnings.add(`<${tag}> is not imported`);
	const drafts: Draft[] = [];
	if (draft !== null) drafts.push(draft);
	return drafts;
}

function unionOf(rects: readonly Rect[]): Rect {
	const left = Math.min(...rects.map((rect) => rect.x));
	const top = Math.min(...rects.map((rect) => rect.y));
	const right = Math.max(...rects.map((rect) => rect.x + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundsOfDraft(draft: Draft): Rect {
	if (draft.kind === 'shape') return draft.bounds;
	return unionOf(draft.children.map(boundsOfDraft));
}

/** Nodes for `drafts` under `parentId`, positioned relative to `origin` (the parent's top left). */
function materialize(
	drafts: readonly Draft[],
	parentId: NodeId,
	origin: { x: number; y: number },
	output: Node[]
): void {
	const indexes = keysBetween(null, null, drafts.length);
	drafts.forEach((draft, position) => {
		if (draft.kind === 'shape') {
			const [[a, c, e], [b, d, f]] = draft.node.transform;
			output.push({
				...draft.node,
				parentId,
				index: indexes[position],
				transform: [
					[a, c, e - origin.x],
					[b, d, f - origin.y]
				]
			} as Node);
			return;
		}
		const bounds = boundsOfDraft(draft);
		const group = createNode('GROUP', {
			id: generateNodeId(),
			name: draft.name,
			parentId,
			index: indexes[position],
			transform: translationMatrix(bounds.x - origin.x, bounds.y - origin.y),
			width: bounds.width,
			height: bounds.height,
			opacity: draft.opacity
		});
		output.push(group);
		materialize(draft.children, group.id, { x: bounds.x, y: bounds.y }, output);
	});
}

/** The first `<svg>` of `markup`, or null when it is not SVG. */
function parseRoot(markup: string): Element | null {
	const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
	if (parsed.getElementsByTagName('parsererror').length > 0) return null;
	const root = parsed.documentElement;
	if (tagName(root) !== 'svg') return null;
	return root;
}

/** Import `markup`; null when it is not a parseable SVG document. */
export function importSvg(markup: string, options: SvgImportOptions = {}): SvgImport | null {
	const root = parseRoot(markup);
	if (!root) return null;
	const viewport = viewportOf(root);
	const warnings = new Set<string>();
	const session: Session = {
		elements: indexElements(root),
		rules: collectStyleSheets(root),
		warnings,
		gradients: {
			elements: new Map(),
			rules: [],
			viewport: { width: viewport.width, height: viewport.height },
			warn: (message) => warnings.add(message)
		}
	};
	session.gradients.elements = session.elements;
	session.gradients.rules = session.rules;
	const rootStyle = computedStyle({}, ownStyle(root, session.rules));
	const drafts = convertChildren(root, viewport.matrix, rootStyle, session, 0);
	const frame = createNode('FRAME', {
		id: generateNodeId(),
		name: options.name === undefined ? 'SVG' : options.name,
		width: viewport.width,
		height: viewport.height,
		fills: [],
		clipsContent: true
	});
	const nodes: Node[] = [frame];
	materialize(drafts, frame.id, { x: 0, y: 0 }, nodes);
	return {
		nodes,
		rootId: frame.id,
		width: viewport.width,
		height: viewport.height,
		warnings: [...warnings]
	};
}
