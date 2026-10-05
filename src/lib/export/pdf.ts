// Vector PDF writer (#128), the documented fallback for a custom CanvasKit build with SkPDF.
//
// Decision of the spike: the stock canvaskit-wasm has no SkPDF, and a build with
// `skia_enable_pdf` needs the Skia sources and an Emscripten toolchain, neither of which can be
// fetched or run offline. Instead the scene is written to PDF directly: paths stay paths, so the
// output is vector, and nothing but this file and the scene is involved. A real SkPDF build can
// later replace the provider behind the same `export` format seam without touching callers.
//
// Covered: shapes (as in the SVG export), corner radii, frame clipping, solid fills and strokes
// with opacity, stroke alignment/caps/joins/dashes, text in Helvetica (no wrapping, Latin-1 only).
// Gradients are flattened to the stop nearest the middle. Not covered (listed in `warnings`):
// image fills, effects, masks, blend modes, group opacity as a unit (it multiplies per paint).
// One page per root passed in; a document with several roots has several pages.

import { nodeOutline, type PathCommand } from '../document/outline';
import { resolveStyle } from '../document/text';
import type {
	Matrix2x3,
	NodeId,
	Paint,
	Rect,
	RGB,
	SceneNode,
	Stroke,
	TextNode
} from '../document/types';
import type { SceneSource } from '../renderer/sceneSource';
import { formatNumber } from './svgPaint';

export interface PdfGeometry {
	absoluteTransform(id: NodeId): Matrix2x3;
}

export interface PdfPage {
	nodeId: NodeId;
	/** The page-space area shown on the page. */
	area: Rect;
}

export interface PdfResult {
	bytes: Uint8Array;
	pageCount: number;
	warnings: string[];
}

/** A page is `area.width x area.height` points times `scale`. */
export function serializePdf(
	source: SceneSource,
	geometry: PdfGeometry,
	pages: readonly PdfPage[],
	scale: number
): PdfResult {
	const writer = new PdfScene(source);
	const contents = pages.map((page) => writer.pageContent(geometry, page, scale));
	const document = new PdfDocument();
	const sizes = pages.map((page) => ({
		width: page.area.width * scale,
		height: page.area.height * scale
	}));
	const bytes = document.build(contents, sizes, writer.graphicsStates());
	return { bytes, pageCount: pages.length, warnings: [...writer.warnings] };
}

// ---------- arcs ----------

/** Cubic segments for an elliptical arc (SVG endpoint parameterisation, no rotation). */
export function arcToCubics(
	startX: number,
	startY: number,
	command: Extract<PathCommand, { op: 'arc' }>
): PathCommand[] {
	let radiusX = Math.abs(command.radiusX);
	let radiusY = Math.abs(command.radiusY);
	const { x: endX, y: endY } = command;
	if (radiusX === 0 || radiusY === 0) return [{ op: 'line', x: endX, y: endY }];
	const halfDx = (startX - endX) / 2;
	const halfDy = (startY - endY) / 2;
	const lambda = (halfDx / radiusX) ** 2 + (halfDy / radiusY) ** 2;
	if (lambda > 1) {
		radiusX *= Math.sqrt(lambda);
		radiusY *= Math.sqrt(lambda);
	}
	const numerator = (radiusX * radiusY) ** 2 - (radiusX * halfDy) ** 2 - (radiusY * halfDx) ** 2;
	const denominator = (radiusX * halfDy) ** 2 + (radiusY * halfDx) ** 2;
	let factor = Math.sqrt(Math.max(0, numerator / denominator));
	// small arc (large-arc flag 0): the centre is on the side the sweep direction picks
	if (!command.clockwise) factor = -factor;
	const centreXPrime = (factor * radiusX * halfDy) / radiusY;
	const centreYPrime = (-factor * radiusY * halfDx) / radiusX;
	const centreX = centreXPrime + (startX + endX) / 2;
	const centreY = centreYPrime + (startY + endY) / 2;
	const startAngle = Math.atan2((startY - centreY) / radiusY, (startX - centreX) / radiusX);
	const endAngle = Math.atan2((endY - centreY) / radiusY, (endX - centreX) / radiusX);
	let sweep = endAngle - startAngle;
	if (command.clockwise && sweep < 0) sweep += Math.PI * 2;
	if (!command.clockwise && sweep > 0) sweep -= Math.PI * 2;
	return cubicsOnEllipse(centreX, centreY, radiusX, radiusY, startAngle, sweep);
}

function cubicsOnEllipse(
	centreX: number,
	centreY: number,
	radiusX: number,
	radiusY: number,
	startAngle: number,
	sweep: number
): PathCommand[] {
	const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
	const step = sweep / segments;
	const handle = (4 / 3) * Math.tan(step / 4);
	const commands: PathCommand[] = [];
	for (let index = 0; index < segments; index += 1) {
		const from = startAngle + index * step;
		const to = from + step;
		commands.push({
			op: 'cubic',
			x1: centreX + radiusX * (Math.cos(from) - handle * Math.sin(from)),
			y1: centreY + radiusY * (Math.sin(from) + handle * Math.cos(from)),
			x2: centreX + radiusX * (Math.cos(to) + handle * Math.sin(to)),
			y2: centreY + radiusY * (Math.sin(to) - handle * Math.cos(to)),
			x: centreX + radiusX * Math.cos(to),
			y: centreY + radiusY * Math.sin(to)
		});
	}
	return commands;
}

function pathOperators(commands: readonly PathCommand[]): string {
	const parts: string[] = [];
	let currentX = 0;
	let currentY = 0;
	let startX = 0;
	let startY = 0;
	for (const command of commands) {
		const expanded = command.op === 'arc' ? arcToCubics(currentX, currentY, command) : [command];
		for (const part of expanded) {
			parts.push(operatorFor(part));
			if (part.op === 'move') {
				startX = part.x;
				startY = part.y;
			}
			if (part.op === 'close') {
				currentX = startX;
				currentY = startY;
			}
			if (part.op !== 'close' && part.op !== 'arc') {
				currentX = part.x;
				currentY = part.y;
			}
		}
	}
	return parts.join('\n');
}

function operatorFor(command: PathCommand): string {
	if (command.op === 'move') return `${num(command.x)} ${num(command.y)} m`;
	if (command.op === 'line') return `${num(command.x)} ${num(command.y)} l`;
	if (command.op === 'close') return 'h';
	if (command.op === 'cubic') {
		const values = [command.x1, command.y1, command.x2, command.y2, command.x, command.y];
		return `${values.map(num).join(' ')} c`;
	}
	return '';
}

function num(value: number): string {
	return formatNumber(value);
}

function matrixOperands(matrix: Matrix2x3): string {
	const [[a, c, e], [b, d, f]] = matrix;
	return [a, b, c, d, e, f].map(num).join(' ');
}

function colorOperands(color: RGB): string {
	return `${num(color.r)} ${num(color.g)} ${num(color.b)}`;
}

/** The colour and opacity a paint draws with in PDF: gradients become their middle stop. */
function flatColor(paint: Paint): { color: RGB; alpha: number } | null {
	if (!paint.visible || paint.opacity <= 0 || paint.type === 'IMAGE') return null;
	if (paint.type === 'SOLID') return { color: paint.color, alpha: paint.opacity };
	if (paint.gradientStops.length === 0) return null;
	let nearest = paint.gradientStops[0];
	for (const stop of paint.gradientStops) {
		if (Math.abs(stop.position - 0.5) < Math.abs(nearest.position - 0.5)) nearest = stop;
	}
	return { color: nearest.color, alpha: paint.opacity * nearest.color.a };
}

// ---------- scene to content stream ----------

class PdfScene {
	readonly warnings = new Set<string>();
	private readonly states: number[] = [];

	constructor(private readonly source: SceneSource) {}

	graphicsStates(): number[] {
		return this.states;
	}

	pageContent(geometry: PdfGeometry, page: PdfPage, scale: number): string {
		const { area } = page;
		const height = area.height * scale;
		const flip = matrixOperands([
			[scale, 0, -area.x * scale],
			[0, -scale, height + area.y * scale]
		]);
		const node = this.source.getNode(page.nodeId);
		let parent = '';
		if (node && node.parentId !== null) {
			parent = `${matrixOperands(geometry.absoluteTransform(node.parentId))} cm\n`;
		}
		return `q\n${flip} cm\n${parent}${this.node(page.nodeId, 1)}Q\n`;
	}

	/** Index of the graphics state with this alpha, creating it. */
	private stateFor(alpha: number): string {
		const key = Math.round(alpha * 1000);
		let index = this.states.indexOf(key);
		if (index < 0) {
			this.states.push(key);
			index = this.states.length - 1;
		}
		return `/GS${index} gs\n`;
	}

	private node(id: NodeId, parentOpacity: number): string {
		const stored = this.source.getNode(id);
		if (!stored || stored.type === 'PAGE') return '';
		const node = this.source.resolve(stored);
		if (node.type === 'SLICE' || !node.visible) return '';
		let opacity = parentOpacity;
		if ('opacity' in node) opacity *= node.opacity;
		this.reportUnsupported(node);
		let markup = `q\n${matrixOperands(node.transform)} cm\n`;
		markup += this.own(node, opacity);
		markup += this.children(node, opacity);
		return `${markup}Q\n`;
	}

	private reportUnsupported(node: SceneNode): void {
		if (!('effects' in node)) return;
		if (node.effects.some((effect) => effect.visible))
			this.warnings.add('effects are not exported');
		if (node.isMask) this.warnings.add('masks are not exported');
		if (node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') {
			this.warnings.add('blend modes are not exported');
		}
	}

	private own(node: SceneNode, opacity: number): string {
		if (node.type === 'TEXT') return this.text(node, opacity);
		const outline = nodeOutline(node);
		if (outline === null || !('fills' in node)) return '';
		let markup = '';
		if (outline.fill.length > 0) {
			markup += this.fill(node.fills, outline.fill, outline.fillRule, opacity);
		}
		for (const region of outline.regionFills ?? []) {
			markup += this.fill(region.fills, region.commands, region.fillRule, opacity);
		}
		for (const stroke of node.strokes) {
			markup += this.stroke(stroke, outline.stroke, outline.closed, outline.fillRule, opacity);
		}
		return markup;
	}

	private fill(
		paints: readonly Paint[],
		commands: readonly PathCommand[],
		rule: 'NONZERO' | 'EVENODD',
		opacity: number
	): string {
		let markup = '';
		let operator = 'f';
		if (rule === 'EVENODD') operator = 'f*';
		for (const paint of paints) {
			if (paint.type === 'IMAGE') this.warnings.add('image fills are not exported to PDF');
			if (paint.type !== 'SOLID' && paint.type !== 'IMAGE') {
				this.warnings.add('gradients are exported as their middle colour');
			}
			const flat = flatColor(paint);
			if (flat === null) continue;
			markup += this.stateFor(flat.alpha * opacity);
			markup += `${colorOperands(flat.color)} rg\n${pathOperators(commands)}\n${operator}\n`;
		}
		return markup;
	}

	private stroke(
		stroke: Stroke,
		commands: readonly PathCommand[],
		closed: boolean,
		rule: 'NONZERO' | 'EVENODD',
		opacity: number
	): string {
		const weight = strokeWeight(stroke);
		if (weight <= 0) return '';
		let align = stroke.align;
		if (!closed) align = 'CENTER';
		let markup = '';
		for (const paint of stroke.paints) {
			const flat = flatColor(paint);
			if (flat === null) continue;
			markup += 'q\n';
			markup += this.alignmentClip(align, commands, rule);
			markup += this.stateFor(flat.alpha * opacity);
			markup += `${colorOperands(flat.color)} RG\n${num(this.width(align, weight))} w\n`;
			markup += `${strokeStyle(stroke)}${pathOperators(commands)}\nS\nQ\n`;
		}
		return markup;
	}

	private width(align: Stroke['align'], weight: number): number {
		if (align === 'CENTER') return weight;
		return weight * 2;
	}

	/** Inside and outside strokes are the double-width stroke clipped to one side of the shape. */
	private alignmentClip(
		align: Stroke['align'],
		commands: readonly PathCommand[],
		rule: 'NONZERO' | 'EVENODD'
	): string {
		if (align === 'CENTER') return '';
		if (align === 'INSIDE') {
			let operator = 'W';
			if (rule === 'EVENODD') operator = 'W*';
			return `${pathOperators(commands)}\n${operator} n\n`;
		}
		return `-100000 -100000 200000 200000 re\n${pathOperators(commands)}\nW* n\n`;
	}

	private children(node: SceneNode, opacity: number): string {
		if (node.type === 'BOOLEAN_OPERATION') {
			this.warnings.add('boolean operations are not exported to PDF');
			return '';
		}
		if (node.type === 'SECTION' && node.sectionContentsHidden) return '';
		let markup = '';
		for (const childId of this.source.children(node.id)) markup += this.node(childId, opacity);
		if (markup === '') return '';
		const clip = this.clip(node);
		if (clip === '') return markup;
		return `q\n${clip}${markup}Q\n`;
	}

	private clip(node: SceneNode): string {
		const clips =
			(node.type === 'FRAME' ||
				node.type === 'COMPONENT' ||
				node.type === 'COMPONENT_SET' ||
				node.type === 'INSTANCE') &&
			node.clipsContent;
		if (!clips) return '';
		const outline = nodeOutline(node);
		if (outline === null || outline.fill.length === 0) return '';
		return `${pathOperators(outline.fill)}\nW n\n`;
	}

	private text(node: TextNode, opacity: number): string {
		this.warnings.add('text is exported in Helvetica without line wrapping');
		let markup = '';
		let top = 0;
		for (const paragraph of node.paragraphs) {
			const first = resolveStyle(node.defaultStyle, paragraph.runs[0]?.style ?? {});
			const lineHeight = lineHeightOf(first.fontSize, first.lineHeight);
			const baseline = top + lineHeight / 2 + first.fontSize * 0.35;
			let x = paragraph.indent;
			const runs = paragraph.runs.map((run) => ({
				text: run.text,
				style: resolveStyle(node.defaultStyle, run.style)
			}));
			const widths = runs.map((run) => estimatedWidth(run.text, run.style.fontSize));
			const total = widths.reduce((sum, width) => sum + width, 0);
			if (paragraph.align === 'CENTER') x = (node.width - total) / 2;
			if (paragraph.align === 'RIGHT') x = node.width - total;
			runs.forEach((run, index) => {
				markup += this.textRun(run.text, run.style, x, baseline, opacity);
				x += widths[index];
			});
			top += lineHeight + paragraph.spacingAfter;
		}
		return markup;
	}

	private textRun(
		text: string,
		style: ReturnType<typeof resolveStyle>,
		x: number,
		baseline: number,
		opacity: number
	): string {
		const flat = style.fills.map(flatColor).find((entry) => entry !== null);
		if (flat === undefined || flat === null || text === '') return '';
		const font = fontFor(style.fontWeight);
		const state = this.stateFor(flat.alpha * opacity);
		return `${state}BT\n${colorOperands(flat.color)} rg\n/${font} ${num(style.fontSize)} Tf\n1 0 0 -1 ${num(x)} ${num(baseline)} Tm\n(${escapePdfString(text)}) Tj\nET\n`;
	}
}

function strokeWeight(stroke: Stroke): number {
	if (typeof stroke.weight === 'number') return stroke.weight;
	const { top, right, bottom, left } = stroke.weight;
	return Math.max(top, right, bottom, left);
}

function strokeStyle(stroke: Stroke): string {
	let cap = 0;
	if (stroke.cap === 'ROUND') cap = 1;
	if (stroke.cap === 'SQUARE') cap = 2;
	let join = 0;
	if (stroke.join === 'ROUND') join = 1;
	if (stroke.join === 'BEVEL') join = 2;
	let markup = `${cap} J\n${join} j\n${num(stroke.miterLimit)} M\n`;
	if (stroke.dashPattern.length > 0) markup += `[${stroke.dashPattern.map(num).join(' ')}] 0 d\n`;
	return markup;
}

function lineHeightOf(fontSize: number, lineHeight: { unit: string; value?: number }): number {
	if (lineHeight.unit === 'PIXELS' && lineHeight.value !== undefined) return lineHeight.value;
	if (lineHeight.unit === 'PERCENT' && lineHeight.value !== undefined) {
		return (lineHeight.value / 100) * fontSize;
	}
	return fontSize * 1.2;
}

/** Helvetica averages about half an em per character: good enough to place aligned text. */
function estimatedWidth(text: string, fontSize: number): number {
	return text.length * fontSize * 0.52;
}

function fontFor(weight: number): string {
	if (weight >= 600) return 'F2';
	return 'F1';
}

function escapePdfString(text: string): string {
	let escaped = '';
	for (const character of text) {
		const code = character.codePointAt(0);
		if (code === undefined || code > 255 || code < 32) {
			escaped += '?';
			continue;
		}
		if (character === '(' || character === ')' || character === '\\') escaped += '\\';
		escaped += character;
	}
	return escaped;
}

// ---------- file structure ----------

class PdfDocument {
	build(
		contents: readonly string[],
		sizes: ReadonlyArray<{ width: number; height: number }>,
		alphaStates: readonly number[]
	): Uint8Array {
		const objects: string[] = [];
		const add = (body: string): number => {
			objects.push(body);
			return objects.length;
		};
		add('<< /Type /Catalog /Pages 2 0 R >>');
		add('');
		add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
		add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
		const stateNumbers = alphaStates.map((key) =>
			add(`<< /Type /ExtGState /ca ${num(key / 1000)} /CA ${num(key / 1000)} >>`)
		);
		const states = stateNumbers.map((number, index) => `/GS${index} ${number} 0 R`).join(' ');
		const resources = add(`<< /Font << /F1 3 0 R /F2 4 0 R >> /ExtGState << ${states} >> >>`);
		const pageNumbers: number[] = [];
		contents.forEach((content, index) => {
			const stream = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
			const { width, height } = sizes[index];
			pageNumbers.push(
				add(
					`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources ${resources} 0 R /Contents ${stream} 0 R >>`
				)
			);
		});
		objects[1] = `<< /Type /Pages /Count ${pageNumbers.length} /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] >>`;
		return this.serialize(objects);
	}

	private serialize(objects: readonly string[]): Uint8Array {
		let output = '%PDF-1.4\n';
		const offsets: number[] = [];
		objects.forEach((body, index) => {
			offsets.push(output.length);
			output += `${index + 1} 0 obj\n${body}\nendobj\n`;
		});
		const xref = output.length;
		output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
		for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
		output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
		const bytes = new Uint8Array(output.length);
		for (let index = 0; index < output.length; index += 1) bytes[index] = output.charCodeAt(index);
		return bytes;
	}
}
