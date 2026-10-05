// Glyph outlines from a TrueType font file (#103: flattening text). CanvasKit's wasm build has no
// glyph path API, so the outlines come from the font itself: the `glyf` table of an sfnt file
// (what the fonts service delivers, WOFF already inflated). Skia's Paragraph supplies the shaped
// glyph ids and positions; this turns an id into path commands. Pure: no Skia, no kernel.
//
// Supported: simple and composite glyphs of TrueType flavoured fonts, and CFF (`OTTO`) fonts through
// cffOutlines.ts. Anything else (CID keyed CFF, bitmap fonts) gives null.

import type { PathCommand } from '../document/outline';
import { CffOutlines } from './cffOutlines';

interface Point {
	x: number;
	y: number;
	onCurve: boolean;
}

const COMPOSITE_ARGS_ARE_WORDS = 0x0001;
const COMPOSITE_ARGS_ARE_XY = 0x0002;
const COMPOSITE_HAVE_SCALE = 0x0008;
const COMPOSITE_MORE_COMPONENTS = 0x0020;
const COMPOSITE_HAVE_X_Y_SCALE = 0x0040;
const COMPOSITE_HAVE_TWO_BY_TWO = 0x0080;
const FLAG_ON_CURVE = 0x01;
const FLAG_X_SHORT = 0x02;
const FLAG_Y_SHORT = 0x04;
const FLAG_REPEAT = 0x08;
const FLAG_X_SAME_OR_POSITIVE = 0x10;
const FLAG_Y_SAME_OR_POSITIVE = 0x20;
const MAX_COMPOSITE_DEPTH = 8;

interface Table {
	offset: number;
	length: number;
}

export interface GlyphOutlineFont {
	readonly unitsPerEm: number;
	readonly glyphCount: number;
	/**
	 * The outline of glyph `glyphId` at `size` (em height in pixels), origin on the baseline, y
	 * pointing down, shifted by (`originX`, `originY`).
	 */
	glyphCommands(glyphId: number, size: number, originX: number, originY: number): PathCommand[];
}

/** Outlines of a font file (TrueType `glyf` or OpenType `CFF `), or null for anything else. */
export function parseGlyphOutlineFont(bytes: ArrayBuffer): GlyphOutlineFont | null {
	const trueType = TrueTypeFont.parse(bytes);
	if (trueType) return trueType;
	return CffFont.parse(bytes);
}

class CffFont implements GlyphOutlineFont {
	private constructor(
		private readonly outlines: CffOutlines,
		readonly unitsPerEm: number
	) {}

	static parse(bytes: ArrayBuffer): CffFont | null {
		const view = new DataView(bytes);
		if (view.byteLength < 12) return null;
		const tables = readTables(view);
		const head = tables.get('head');
		const cff = tables.get('CFF ');
		if (!head || !cff) return null;
		const unitsPerEm = view.getUint16(head.offset + 18);
		const outlines = CffOutlines.parse(view, cff.offset);
		if (!outlines || unitsPerEm === 0) return null;
		return new CffFont(outlines, unitsPerEm);
	}

	get glyphCount(): number {
		return this.outlines.glyphCount;
	}

	glyphCommands(glyphId: number, size: number, originX: number, originY: number): PathCommand[] {
		const scale = size / this.unitsPerEm;
		return this.outlines
			.glyphCommands(glyphId)
			.map((command) => placed(command, scale, originX, originY));
	}
}

function placed(
	command: PathCommand,
	scale: number,
	originX: number,
	originY: number
): PathCommand {
	const x = (value: number): number => originX + value * scale;
	const y = (value: number): number => originY - value * scale;
	if (command.op === 'move' || command.op === 'line') {
		return { op: command.op, x: x(command.x), y: y(command.y) };
	}
	if (command.op === 'cubic') {
		return {
			op: 'cubic',
			x1: x(command.x1),
			y1: y(command.y1),
			x2: x(command.x2),
			y2: y(command.y2),
			x: x(command.x),
			y: y(command.y)
		};
	}
	return command;
}

class TrueTypeFont implements GlyphOutlineFont {
	private constructor(
		private readonly view: DataView,
		private readonly glyf: Table,
		private readonly loca: Table,
		private readonly longOffsets: boolean,
		readonly glyphCount: number,
		readonly unitsPerEm: number
	) {}

	/** The font's outlines, or null when the file has no TrueType outlines. */
	static parse(bytes: ArrayBuffer): TrueTypeFont | null {
		const view = new DataView(bytes);
		if (view.byteLength < 12) return null;
		const tables = readTables(view);
		const head = tables.get('head');
		const maxp = tables.get('maxp');
		const loca = tables.get('loca');
		const glyf = tables.get('glyf');
		if (!head || !maxp || !loca || !glyf) return null;
		const unitsPerEm = view.getUint16(head.offset + 18);
		const longOffsets = view.getInt16(head.offset + 50) !== 0;
		const glyphCount = view.getUint16(maxp.offset + 4);
		if (unitsPerEm === 0) return null;
		return new TrueTypeFont(view, glyf, loca, longOffsets, glyphCount, unitsPerEm);
	}

	/**
	 * The outline of glyph `glyphId` at `size` (em height in pixels), origin on the baseline, y
	 * pointing down, shifted by (`originX`, `originY`).
	 */
	glyphCommands(glyphId: number, size: number, originX: number, originY: number): PathCommand[] {
		const scale = size / this.unitsPerEm;
		const contours = this.contoursOf(glyphId, 0);
		const commands: PathCommand[] = [];
		for (const contour of contours) {
			const placed = contour.map((point) => ({
				x: originX + point.x * scale,
				y: originY - point.y * scale,
				onCurve: point.onCurve
			}));
			appendContour(commands, placed);
		}
		return commands;
	}

	private glyphRange(glyphId: number): Table | null {
		if (glyphId < 0 || glyphId >= this.glyphCount) return null;
		const { view, loca } = this;
		let start: number;
		let end: number;
		if (this.longOffsets) {
			start = view.getUint32(loca.offset + glyphId * 4);
			end = view.getUint32(loca.offset + glyphId * 4 + 4);
		} else {
			start = view.getUint16(loca.offset + glyphId * 2) * 2;
			end = view.getUint16(loca.offset + glyphId * 2 + 2) * 2;
		}
		if (end <= start) return null;
		return { offset: this.glyf.offset + start, length: end - start };
	}

	private contoursOf(glyphId: number, depth: number): Point[][] {
		const range = this.glyphRange(glyphId);
		if (!range || depth > MAX_COMPOSITE_DEPTH) return [];
		const contourCount = this.view.getInt16(range.offset);
		if (contourCount >= 0) return this.simpleContours(range.offset + 10, contourCount);
		return this.compositeContours(range.offset + 10, depth);
	}

	private simpleContours(start: number, contourCount: number): Point[][] {
		const { view } = this;
		let cursor = start;
		const endPoints: number[] = [];
		for (let index = 0; index < contourCount; index += 1) {
			endPoints.push(view.getUint16(cursor));
			cursor += 2;
		}
		if (contourCount === 0) return [];
		const pointCount = endPoints[contourCount - 1] + 1;
		cursor += 2 + view.getUint16(cursor);
		const flags: number[] = [];
		while (flags.length < pointCount) {
			const flag = view.getUint8(cursor);
			cursor += 1;
			flags.push(flag);
			if ((flag & FLAG_REPEAT) === 0) continue;
			const repeats = view.getUint8(cursor);
			cursor += 1;
			for (let repeat = 0; repeat < repeats; repeat += 1) flags.push(flag);
		}
		const xs = this.readCoordinates(flags, cursor, FLAG_X_SHORT, FLAG_X_SAME_OR_POSITIVE);
		const ys = this.readCoordinates(flags, xs.end, FLAG_Y_SHORT, FLAG_Y_SAME_OR_POSITIVE);
		const contours: Point[][] = [];
		let first = 0;
		for (const last of endPoints) {
			const contour: Point[] = [];
			for (let index = first; index <= last; index += 1) {
				contour.push({
					x: xs.values[index],
					y: ys.values[index],
					onCurve: (flags[index] & FLAG_ON_CURVE) !== 0
				});
			}
			contours.push(contour);
			first = last + 1;
		}
		return contours;
	}

	private readCoordinates(
		flags: readonly number[],
		start: number,
		shortFlag: number,
		sameOrPositiveFlag: number
	): { values: number[]; end: number } {
		const { view } = this;
		let cursor = start;
		let value = 0;
		const values: number[] = [];
		for (const flag of flags) {
			if ((flag & shortFlag) !== 0) {
				const delta = view.getUint8(cursor);
				cursor += 1;
				value += (flag & sameOrPositiveFlag) !== 0 ? delta : -delta;
			} else if ((flag & sameOrPositiveFlag) === 0) {
				value += view.getInt16(cursor);
				cursor += 2;
			}
			values.push(value);
		}
		return { values, end: cursor };
	}

	private compositeContours(start: number, depth: number): Point[][] {
		const { view } = this;
		let cursor = start;
		const contours: Point[][] = [];
		let more = true;
		while (more) {
			const flags = view.getUint16(cursor);
			const componentId = view.getUint16(cursor + 2);
			cursor += 4;
			let offsetX = 0;
			let offsetY = 0;
			if ((flags & COMPOSITE_ARGS_ARE_WORDS) !== 0) {
				offsetX = view.getInt16(cursor);
				offsetY = view.getInt16(cursor + 2);
				cursor += 4;
			} else {
				offsetX = view.getInt8(cursor);
				offsetY = view.getInt8(cursor + 1);
				cursor += 2;
			}
			if ((flags & COMPOSITE_ARGS_ARE_XY) === 0) {
				// point matching is not supported: place the component at the origin
				offsetX = 0;
				offsetY = 0;
			}
			let xx = 1;
			let yx = 0;
			let xy = 0;
			let yy = 1;
			if ((flags & COMPOSITE_HAVE_SCALE) !== 0) {
				xx = view.getInt16(cursor) / 16384;
				yy = xx;
				cursor += 2;
			} else if ((flags & COMPOSITE_HAVE_X_Y_SCALE) !== 0) {
				xx = view.getInt16(cursor) / 16384;
				yy = view.getInt16(cursor + 2) / 16384;
				cursor += 4;
			} else if ((flags & COMPOSITE_HAVE_TWO_BY_TWO) !== 0) {
				xx = view.getInt16(cursor) / 16384;
				yx = view.getInt16(cursor + 2) / 16384;
				xy = view.getInt16(cursor + 4) / 16384;
				yy = view.getInt16(cursor + 6) / 16384;
				cursor += 8;
			}
			for (const contour of this.contoursOf(componentId, depth + 1)) {
				contours.push(
					contour.map((point) => ({
						x: xx * point.x + xy * point.y + offsetX,
						y: yx * point.x + yy * point.y + offsetY,
						onCurve: point.onCurve
					}))
				);
			}
			more = (flags & COMPOSITE_MORE_COMPONENTS) !== 0;
		}
		return contours;
	}
}

function readTables(view: DataView): Map<string, Table> {
	const tables = new Map<string, Table>();
	const count = view.getUint16(4);
	for (let index = 0; index < count; index += 1) {
		const entry = 12 + index * 16;
		if (entry + 16 > view.byteLength) break;
		const tag = String.fromCharCode(
			view.getUint8(entry),
			view.getUint8(entry + 1),
			view.getUint8(entry + 2),
			view.getUint8(entry + 3)
		);
		tables.set(tag, { offset: view.getUint32(entry + 8), length: view.getUint32(entry + 12) });
	}
	return tables;
}

function midpoint(first: Point, second: Point): Point {
	return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, onCurve: true };
}

/** A quadratic from `from` through `control` to `to` as the equivalent cubic. */
function quadraticAsCubic(from: Point, control: Point, to: Point): PathCommand {
	return {
		op: 'cubic',
		x1: from.x + (2 / 3) * (control.x - from.x),
		y1: from.y + (2 / 3) * (control.y - from.y),
		x2: to.x + (2 / 3) * (control.x - to.x),
		y2: to.y + (2 / 3) * (control.y - to.y),
		x: to.x,
		y: to.y
	};
}

/** TrueType contours may start off-curve and have implied on-curve points between off-curve ones. */
function appendContour(commands: PathCommand[], points: readonly Point[]): void {
	if (points.length === 0) return;
	const firstOn = points.findIndex((point) => point.onCurve);
	let start: Point;
	let ordered: Point[];
	if (firstOn >= 0) {
		start = points[firstOn];
		ordered = [...points.slice(firstOn + 1), ...points.slice(0, firstOn)];
	} else {
		start = midpoint(points[0], points[points.length - 1]);
		ordered = [...points];
	}
	commands.push({ op: 'move', x: start.x, y: start.y });
	let current = start;
	let control: Point | null = null;
	const finishWith = (to: Point): void => {
		if (control) commands.push(quadraticAsCubic(current, control, to));
		else commands.push({ op: 'line', x: to.x, y: to.y });
		current = to;
		control = null;
	};
	for (const point of ordered) {
		if (point.onCurve) {
			finishWith(point);
			continue;
		}
		if (control) finishWith(midpoint(control, point));
		control = point;
	}
	finishWith(start);
	commands.push({ op: 'close' });
}
