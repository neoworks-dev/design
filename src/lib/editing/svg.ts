// SVG export of a selection, for "Copy as SVG". Pure: reads a `DocumentReader`, returns markup.
//
// What it covers: frames, groups, rectangles (uniform or per-corner radius), ellipses, lines,
// polygons, stars, vector networks, text (one line per paragraph, estimated positions) and
// boolean groups (as their operands). Per node: visibility, opacity, solid and gradient fills,
// strokes (weight, caps, joins, dashes), drop shadows, layer blur, frame clipping and masks.
// What it leaves out: image fills (the bytes live in the asset store, not in the document),
// inside and outside stroke alignment (drawn centred), inner shadows and background blur.
//
// A mask node masks its siblings below it in z-order, up to the next mask below it.

import type {
	Effect,
	Matrix2x3,
	Node,
	NodeId,
	Paint,
	RGB,
	Rect,
	ShadowEffect,
	Stroke,
	VectorNetwork,
	VectorRegion,
	Vec2,
	DocumentReader
} from '../document';
import { copyableIds } from './clipboardPayload';
import { unionBounds } from './selectionOps';

type Attributes = Record<string, string | number>;

const CONTAINER_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'];
const GROUP_TYPES = ['GROUP', 'BOOLEAN_OPERATION'];

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function escapeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attributesText(attributes: Attributes): string {
	const entries = Object.entries(attributes).map(
		([name, value]) => `${name}="${escapeText(String(value)).replace(/"/g, '&quot;')}"`
	);
	if (entries.length === 0) return '';
	return ` ${entries.join(' ')}`;
}

function element(tag: string, attributes: Attributes, inner = ''): string {
	if (inner === '') return `<${tag}${attributesText(attributes)}/>`;
	return `<${tag}${attributesText(attributes)}>${inner}</${tag}>`;
}

export function hexOf(color: RGB): string {
	const channel = (value: number): string =>
		Math.round(Math.min(1, Math.max(0, value)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function matrixText(transform: Matrix2x3): string {
	const [[a, c, e], [b, d, f]] = transform;
	return `matrix(${[a, b, c, d, e, f].map(round).join(' ')})`;
}

// ---------- state shared while exporting ----------

class Export {
	readonly definitions: string[] = [];
	private counter = 0;

	constructor(readonly reader: DocumentReader) {}

	nextId(prefix: string): string {
		this.counter += 1;
		return `${prefix}${this.counter}`;
	}
}

// ---------- paints ----------

function gradientDefinition(exporter: Export, paint: Paint): string | null {
	if (paint.type === 'SOLID' || paint.type === 'IMAGE') return null;
	const id = exporter.nextId('gradient');
	const stops = paint.gradientStops
		.map((stop) =>
			element('stop', {
				offset: round(stop.position),
				'stop-color': hexOf(stop.color),
				'stop-opacity': round(stop.color.a)
			})
		)
		.join('');
	const radial = paint.type !== 'GRADIENT_LINEAR';
	const [[a, c, e], [b, d, f]] = paint.gradientTransform;
	// The gradient transform maps node space (unit square) to gradient space; SVG wants the
	// gradient space expressed in the node's, so the matrix is applied as given on the unit box.
	const attributes: Attributes = {
		id,
		gradientUnits: 'objectBoundingBox',
		gradientTransform: matrixText([
			[a, c, e],
			[b, d, f]
		])
	};
	if (radial) Object.assign(attributes, { cx: 0.5, cy: 0.5, r: 0.5 });
	else Object.assign(attributes, { x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
	exporter.definitions.push(
		element(radial ? 'radialGradient' : 'linearGradient', attributes, stops)
	);
	return id;
}

/** SVG paint attributes for `paint` under the given prefix (`fill` or `stroke`); null when none. */
function paintAttributes(
	exporter: Export,
	paint: Paint,
	prefix: 'fill' | 'stroke'
): Attributes | null {
	if (!paint.visible) return null;
	if (paint.type === 'IMAGE') return null;
	const attributes: Attributes = {};
	if (paint.type === 'SOLID') {
		attributes[prefix] = hexOf(paint.color);
		attributes[`${prefix}-opacity`] = round(paint.opacity);
		return attributes;
	}
	const id = gradientDefinition(exporter, paint);
	if (id === null) return null;
	attributes[prefix] = `url(#${id})`;
	attributes[`${prefix}-opacity`] = round(paint.opacity);
	return attributes;
}

function strokeWidth(stroke: Stroke): number {
	if (typeof stroke.weight === 'number') return stroke.weight;
	const { top, right, bottom, left } = stroke.weight;
	return Math.max(top, right, bottom, left);
}

function strokeAttributes(exporter: Export, stroke: Stroke, paint: Paint): Attributes | null {
	const color = paintAttributes(exporter, paint, 'stroke');
	if (color === null) return null;
	const attributes: Attributes = {
		fill: 'none',
		...color,
		'stroke-width': round(strokeWidth(stroke))
	};
	const caps: Record<string, string> = { ROUND: 'round', SQUARE: 'square' };
	if (caps[stroke.cap] !== undefined) attributes['stroke-linecap'] = caps[stroke.cap];
	if (stroke.join === 'ROUND') attributes['stroke-linejoin'] = 'round';
	if (stroke.join === 'BEVEL') attributes['stroke-linejoin'] = 'bevel';
	if (stroke.dashPattern.length > 0) attributes['stroke-dasharray'] = stroke.dashPattern.join(' ');
	return attributes;
}

// ---------- geometry ----------

interface Shape {
	tag: string;
	attributes: Attributes;
}

function roundedRectanglePath(width: number, height: number, radii: number[]): string {
	const limit = Math.min(width, height) / 2;
	const [topLeft, topRight, bottomRight, bottomLeft] = radii.map((radius) =>
		Math.min(radius, limit)
	);
	return [
		`M${topLeft} 0`,
		`H${round(width - topRight)}`,
		`A${topRight} ${topRight} 0 0 1 ${width} ${topRight}`,
		`V${round(height - bottomRight)}`,
		`A${bottomRight} ${bottomRight} 0 0 1 ${round(width - bottomRight)} ${height}`,
		`H${bottomLeft}`,
		`A${bottomLeft} ${bottomLeft} 0 0 1 0 ${round(height - bottomLeft)}`,
		`V${topLeft}`,
		`A${topLeft} ${topLeft} 0 0 1 ${topLeft} 0Z`
	].join(' ');
}

function rectangleShape(node: Node, width: number, height: number): Shape {
	const radius: unknown = Reflect.get(node, 'cornerRadius');
	if (Array.isArray(radius)) {
		const radii = radius.map(Number);
		return { tag: 'path', attributes: { d: roundedRectanglePath(width, height, radii) } };
	}
	const attributes: Attributes = { width: round(width), height: round(height) };
	if (typeof radius === 'number' && radius > 0) {
		attributes.rx = round(radius);
		attributes.ry = round(radius);
	}
	return { tag: 'rect', attributes };
}

function polygonPoints(width: number, height: number, count: number, innerRatio: number): string {
	const points: string[] = [];
	const vertices = innerRatio > 0 ? count * 2 : count;
	for (let position = 0; position < vertices; position += 1) {
		const angle = (position / vertices) * Math.PI * 2 - Math.PI / 2;
		const ratio = innerRatio > 0 && position % 2 === 1 ? innerRatio : 1;
		const x = width / 2 + (Math.cos(angle) * width * ratio) / 2;
		const y = height / 2 + (Math.sin(angle) * height * ratio) / 2;
		points.push(`${round(x)},${round(y)}`);
	}
	return points.join(' ');
}

function vertexPoint(network: VectorNetwork, index: number): Vec2 {
	const vertex = network.vertices[index];
	return { x: vertex.x, y: vertex.y };
}

function segmentPath(network: VectorNetwork, segmentIndex: number): string {
	const segment = network.segments[segmentIndex];
	const start = vertexPoint(network, segment.start);
	const end = vertexPoint(network, segment.end);
	const first = segment.tangentStart;
	const second = segment.tangentEnd;
	if (first === undefined && second === undefined) return `L${round(end.x)} ${round(end.y)}`;
	const control1 = {
		x: start.x + (first === undefined ? 0 : first.x),
		y: start.y + (first === undefined ? 0 : first.y)
	};
	const control2 = {
		x: end.x + (second === undefined ? 0 : second.x),
		y: end.y + (second === undefined ? 0 : second.y)
	};
	return `C${round(control1.x)} ${round(control1.y)} ${round(control2.x)} ${round(control2.y)} ${round(end.x)} ${round(end.y)}`;
}

function regionsOf(network: VectorNetwork): VectorRegion[] {
	if (network.regions === undefined) return [];
	return network.regions;
}

function vectorPath(network: VectorNetwork): string {
	const parts: string[] = [];
	const inRegion = new Set<number>();
	for (const region of regionsOf(network)) {
		for (const loop of region.loops) {
			const start = vertexPoint(network, network.segments[loop[0]].start);
			parts.push(`M${round(start.x)} ${round(start.y)}`);
			for (const segmentIndex of loop) {
				parts.push(segmentPath(network, segmentIndex));
				inRegion.add(segmentIndex);
			}
			parts.push('Z');
		}
	}
	network.segments.forEach((segment, index) => {
		if (inRegion.has(index)) return;
		const start = vertexPoint(network, segment.start);
		parts.push(`M${round(start.x)} ${round(start.y)}`, segmentPath(network, index));
	});
	return parts.join(' ');
}

function geometryOf(node: Node): Shape | null {
	if (node.type === 'PAGE' || node.type === 'SLICE') return null;
	const { width, height } = node;
	switch (node.type) {
		case 'ELLIPSE':
			return {
				tag: 'ellipse',
				attributes: {
					cx: round(width / 2),
					cy: round(height / 2),
					rx: round(width / 2),
					ry: round(height / 2)
				}
			};
		case 'LINE':
			return { tag: 'line', attributes: { x1: 0, y1: 0, x2: round(width), y2: 0 } };
		case 'POLYGON':
			return {
				tag: 'polygon',
				attributes: { points: polygonPoints(width, height, node.pointCount, 0) }
			};
		case 'STAR':
			return {
				tag: 'polygon',
				attributes: { points: polygonPoints(width, height, node.pointCount, node.innerRadius) }
			};
		case 'VECTOR':
			return { tag: 'path', attributes: { d: vectorPath(node.network) } };
		case 'TEXT':
		case 'GROUP':
		case 'BOOLEAN_OPERATION':
			return null;
		default:
			return rectangleShape(node, width, height);
	}
}

// ---------- effects ----------

function dropShadows(effects: Effect[]): ShadowEffect[] {
	const shadows: ShadowEffect[] = [];
	for (const effect of effects) {
		if (effect.type === 'DROP_SHADOW' && effect.visible) shadows.push(effect);
	}
	return shadows;
}

function filterFor(exporter: Export, effects: Effect[]): string | null {
	const primitives: string[] = [];
	for (const shadow of dropShadows(effects)) {
		primitives.push(
			element('feDropShadow', {
				dx: round(shadow.offset.x),
				dy: round(shadow.offset.y),
				stdDeviation: round(shadow.radius / 2),
				'flood-color': hexOf(shadow.color),
				'flood-opacity': round(shadow.color.a)
			})
		);
	}
	for (const effect of effects) {
		if (effect.type === 'LAYER_BLUR' && effect.visible) {
			primitives.push(element('feGaussianBlur', { stdDeviation: round(effect.radius / 2) }));
		}
	}
	if (primitives.length === 0) return null;
	const id = exporter.nextId('filter');
	exporter.definitions.push(
		element(
			'filter',
			{ id, x: '-50%', y: '-50%', width: '200%', height: '200%' },
			primitives.join('')
		)
	);
	return id;
}

// ---------- text ----------

function textElement(node: Node, exporter: Export): string {
	if (node.type !== 'TEXT') return '';
	const style = node.defaultStyle;
	const lineHeight =
		style.lineHeight.unit === 'PIXELS' ? style.lineHeight.value : style.fontSize * 1.25;
	const solid = style.fills.find((paint) => paint.type === 'SOLID' && paint.visible);
	const fill = paintAttributesOrBlack(exporter, solid);
	const lines = node.paragraphs.map((paragraph, position) =>
		element(
			'tspan',
			{ x: 0, y: round(lineHeight * (position + 1) - (lineHeight - style.fontSize) / 2) },
			escapeText(paragraph.runs.map((run) => run.text).join(''))
		)
	);
	return element(
		'text',
		{
			'font-family': style.fontName.family,
			'font-size': style.fontSize,
			'font-weight': style.fontWeight,
			...fill
		},
		lines.join('')
	);
}

function paintAttributesOrBlack(exporter: Export, paint: Paint | undefined): Attributes {
	if (paint === undefined) return { fill: '#000000' };
	const attributes = paintAttributes(exporter, paint, 'fill');
	if (attributes === null) return { fill: '#000000' };
	return attributes;
}

// ---------- nodes ----------

function paintedShape(exporter: Export, node: Node, shape: Shape): string[] {
	const fills: Paint[] = [];
	if ('fills' in node) fills.push(...node.fills);
	const strokes: Stroke[] = [];
	if ('strokes' in node) strokes.push(...node.strokes);
	const parts: string[] = [];
	for (const paint of fills) {
		const attributes = paintAttributes(exporter, paint, 'fill');
		if (attributes === null) continue;
		parts.push(element(shape.tag, { ...shape.attributes, ...attributes, stroke: 'none' }));
	}
	for (const stroke of strokes) {
		for (const paint of stroke.paints) {
			const attributes = strokeAttributes(exporter, stroke, paint);
			if (attributes === null) continue;
			parts.push(element(shape.tag, { ...shape.attributes, ...attributes }));
		}
	}
	return parts;
}

function clipDefinition(exporter: Export, node: Node): string | null {
	if (!CONTAINER_TYPES.includes(node.type)) return null;
	if (!Reflect.get(node, 'clipsContent')) return null;
	const geometry = geometryOf(node);
	if (geometry === null) return null;
	const id = exporter.nextId('clip');
	exporter.definitions.push(
		element('clipPath', { id }, element(geometry.tag, geometry.attributes))
	);
	return id;
}

function maskDefinition(exporter: Export, mask: Node): string {
	const id = exporter.nextId('mask');
	const luminance = Reflect.get(mask, 'maskType') === 'LUMINANCE';
	const geometry = geometryOf(mask);
	let shapes = '';
	if (geometry !== null) {
		// Alpha and vector masks use the shape's outline (fill ignored); luminance uses its paint.
		let inner = element(geometry.tag, { ...geometry.attributes, fill: '#ffffff' });
		if (luminance) inner = paintedShape(exporter, mask, geometry).join('');
		shapes = element('g', { transform: matrixText(localTransform(mask)) }, inner);
	}
	const maskType = luminance ? 'luminance' : 'alpha';
	exporter.definitions.push(element('mask', { id, 'mask-type': maskType }, shapes));
	return id;
}

function identity(): Matrix2x3 {
	return [
		[1, 0, 0],
		[0, 1, 0]
	];
}

function localTransform(node: Node): Matrix2x3 {
	if (node.type === 'PAGE') return identity();
	return node.transform;
}

function childrenSvg(exporter: Export, parentId: NodeId): string {
	const output: string[] = [];
	let pending: string[] = [];
	for (const child of exporter.reader.childNodes(parentId)) {
		if (child.type === 'PAGE' || !child.visible) continue;
		if (Reflect.get(child, 'isMask') === true) {
			const maskId = maskDefinition(exporter, child);
			if (pending.length > 0)
				output.push(element('g', { mask: `url(#${maskId})` }, pending.join('')));
			pending = [];
			continue;
		}
		pending.push(nodeSvg(exporter, child, localTransform(child)));
	}
	output.push(...pending);
	return output.join('');
}

function bodyOf(exporter: Export, node: Node): string {
	if (GROUP_TYPES.includes(node.type)) return childrenSvg(exporter, node.id);
	if (node.type === 'TEXT') return textElement(node, exporter);
	const geometry = geometryOf(node);
	const shapes: string[] = [];
	if (geometry !== null) shapes.push(...paintedShape(exporter, node, geometry));
	const clip = clipDefinition(exporter, node);
	const children = childrenSvg(exporter, node.id);
	if (clip === null || children === '') return shapes.join('') + children;
	return shapes.join('') + element('g', { 'clip-path': `url(#${clip})` }, children);
}

function nodeSvg(exporter: Export, node: Node, transform: Matrix2x3): string {
	const attributes: Attributes = {
		id: node.id,
		'data-name': node.name,
		transform: matrixText(transform)
	};
	if ('opacity' in node && node.opacity < 1) attributes.opacity = round(node.opacity);
	if ('effects' in node) {
		const filter = filterFor(exporter, node.effects);
		if (filter !== null) attributes.filter = `url(#${filter})`;
	}
	return element('g', attributes, bodyOf(exporter, node));
}

/** The SVG document for the nodes, positioned relative to their common top-left corner. */
export function exportSvg(reader: DocumentReader, ids: readonly NodeId[]): string | null {
	const roots = copyableIds(reader, ids).filter((id) => reader.requireNode(id).type !== 'SLICE');
	if (roots.length === 0) return null;
	const bounds: Rect = unionBounds(roots.map((id) => reader.cache.absoluteBounds(id)));
	const exporter = new Export(reader);
	const body = roots
		.filter((id) => {
			const node = reader.requireNode(id);
			return node.type !== 'PAGE' && node.visible;
		})
		.map((id) => {
			const [[a, c, e], [b, d, f]] = reader.cache.absoluteTransform(id);
			const shifted: Matrix2x3 = [
				[a, c, e - bounds.x],
				[b, d, f - bounds.y]
			];
			return nodeSvg(exporter, reader.requireNode(id), shifted);
		})
		.join('');
	let definitions = '';
	if (exporter.definitions.length > 0) {
		definitions = element('defs', {}, exporter.definitions.join(''));
	}
	const root: Attributes = {
		xmlns: 'http://www.w3.org/2000/svg',
		width: round(bounds.width),
		height: round(bounds.height),
		viewBox: `0 0 ${round(bounds.width)} ${round(bounds.height)}`,
		fill: 'none'
	};
	return element('svg', root, definitions + body);
}
