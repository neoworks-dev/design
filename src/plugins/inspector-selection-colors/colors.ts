// Pure core of the selection colors section: collect the solid colors used below the selection
// and plan their replacement. Rows are keyed by what the color is bound to (variable, style) or
// by its hex value, so a replacement touches exactly the usages that row lists.

import type {
	Node,
	Paint,
	Paragraph,
	RGB,
	SolidPaint,
	Stroke,
	TextStyle
} from '../../lib/document';
import { colorToHex } from '../../lib/ui/color';

export interface ColorRow {
	/** `var:<id>`, `style:<id>` or `hex:#rrggbb`. */
	key: string;
	color: RGB;
	variableId?: string;
	styleId?: string;
	/** Number of paints the color is used in. */
	count: number;
}

type PaintMap = (paint: Paint, binding: Binding) => Paint;

interface Binding {
	/** Style the paint list belongs to, when the node has a fill or stroke style. */
	styleId: string | undefined;
}

function variableOf(paint: SolidPaint): string | undefined {
	const alias = paint.boundVariables?.color;
	if (alias === undefined || Array.isArray(alias)) return undefined;
	return alias.id;
}

export function paintKey(paint: SolidPaint, binding: Binding): string {
	const variableId = variableOf(paint);
	if (variableId !== undefined) return `var:${variableId}`;
	if (binding.styleId !== undefined) return `style:${binding.styleId}`;
	return `hex:${colorToHex(paint.color)}`;
}

// ---------- visiting every paint list of a node ----------

function mapStrokes(strokes: Stroke[], node: Node, map: PaintMap): Stroke[] {
	const styleId = 'strokeStyleId' in node ? node.strokeStyleId : undefined;
	return strokes.map((stroke) => ({
		...stroke,
		paints: stroke.paints.map((paint) => map(paint, { styleId }))
	}));
}

function mapTextStyle(style: Partial<TextStyle>, map: PaintMap): Partial<TextStyle> {
	if (style.fills === undefined) return style;
	return { ...style, fills: style.fills.map((paint) => map(paint, { styleId: undefined })) };
}

function mapParagraphs(paragraphs: Paragraph[], map: PaintMap): Paragraph[] {
	return paragraphs.map((paragraph) => ({
		...paragraph,
		runs: paragraph.runs.map((run) => ({ ...run, style: mapTextStyle(run.style, map) }))
	}));
}

/** The properties of `node` rewritten with `map` applied to every paint. */
export function mapNodePaints(node: Node, map: PaintMap): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	if ('fills' in node) {
		const styleId = node.fillStyleId;
		props.fills = node.fills.map((paint) => map(paint, { styleId }));
	}
	if ('strokes' in node) props.strokes = mapStrokes(node.strokes, node, map);
	if (node.type === 'TEXT') {
		props.defaultStyle = mapTextStyle(node.defaultStyle, map);
		props.paragraphs = mapParagraphs(node.paragraphs, map);
	}
	return props;
}

// ---------- collecting ----------

/** Solid colors used by `nodes`, in order of first use, with how often each is used. */
export function collectColors(nodes: readonly Node[]): ColorRow[] {
	const rows = new Map<string, ColorRow>();
	const visit: PaintMap = (paint, binding) => {
		if (paint.type !== 'SOLID') return paint;
		const key = paintKey(paint, binding);
		const known = rows.get(key);
		if (known !== undefined) {
			known.count += 1;
			return paint;
		}
		rows.set(key, {
			key,
			color: paint.color,
			variableId: variableOf(paint),
			styleId: binding.styleId,
			count: 1
		});
		return paint;
	};
	for (const node of nodes) mapNodePaints(node, visit);
	return [...rows.values()];
}

// ---------- replacing ----------

function replacePaint(paint: SolidPaint, color: RGB): SolidPaint {
	const { boundVariables, ...rest } = paint;
	if (boundVariables === undefined) return { ...rest, color };
	const remaining = { ...boundVariables };
	delete remaining.color;
	if (Object.keys(remaining).length === 0) return { ...rest, color };
	return { ...rest, color, boundVariables: remaining };
}

/**
 * Per node, the properties to set so every paint of row `key` takes `color`. A replaced paint is
 * detached from its variable; a node whose style the row stands for drops that style reference.
 */
export function planColorReplacement(
	nodes: readonly Node[],
	key: string,
	color: RGB
): Map<string, Record<string, unknown>> {
	const plans = new Map<string, Record<string, unknown>>();
	for (const node of nodes) {
		let touched = false;
		const replace: PaintMap = (paint, binding) => {
			if (paint.type !== 'SOLID' || paintKey(paint, binding) !== key) return paint;
			touched = true;
			return replacePaint(paint, color);
		};
		const props = mapNodePaints(node, replace);
		if (!touched) continue;
		const styleId = key.slice('style:'.length);
		if ('fillStyleId' in node && node.fillStyleId === styleId) props.fillStyleId = undefined;
		if ('strokeStyleId' in node && node.strokeStyleId === styleId) props.strokeStyleId = undefined;
		plans.set(node.id, props);
	}
	return plans;
}
