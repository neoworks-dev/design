// Glyph outlines from the `CFF ` table of an OpenType font (Type 2 charstrings): what the bundled
// Geist faces use. See glyphOutlines.ts for why the outlines are read from the font file. Name
// keyed CFF fonts are supported; CID keyed ones (large CJK fonts) are not and parse to null.

import type { PathCommand } from '../document/outline';

interface Range {
	start: number;
	end: number;
}

type Dictionary = Map<number, number[]>;

const ESCAPE_BASE = 1200;
const OP_CHARSTRINGS = 17;
const OP_PRIVATE = 18;
const OP_SUBRS = 19;
const OP_ROS = ESCAPE_BASE + 30;
const MAX_CALL_DEPTH = 10;
const MAX_STACK = 96;

function readIndex(view: DataView, start: number): { items: Range[]; end: number } {
	const count = view.getUint16(start);
	if (count === 0) return { items: [], end: start + 2 };
	const offsetSize = view.getUint8(start + 2);
	const offsetsStart = start + 3;
	const dataStart = offsetsStart + (count + 1) * offsetSize - 1;
	const readOffset = (index: number): number => {
		let value = 0;
		for (let byte = 0; byte < offsetSize; byte += 1) {
			value = value * 256 + view.getUint8(offsetsStart + index * offsetSize + byte);
		}
		return value;
	};
	const items: Range[] = [];
	for (let index = 0; index < count; index += 1) {
		items.push({ start: dataStart + readOffset(index), end: dataStart + readOffset(index + 1) });
	}
	return { items, end: dataStart + readOffset(count) };
}

function readDictionary(view: DataView, range: Range): Dictionary {
	const dictionary: Dictionary = new Map();
	let operands: number[] = [];
	let cursor = range.start;
	while (cursor < range.end) {
		const byte = view.getUint8(cursor);
		cursor += 1;
		if (byte <= 21) {
			let operator = byte;
			if (byte === 12) {
				operator = ESCAPE_BASE + view.getUint8(cursor);
				cursor += 1;
			}
			dictionary.set(operator, operands);
			operands = [];
		} else if (byte === 28) {
			operands.push(view.getInt16(cursor));
			cursor += 2;
		} else if (byte === 29) {
			operands.push(view.getInt32(cursor));
			cursor += 4;
		} else if (byte === 30) {
			cursor = skipReal(view, cursor);
			operands.push(0);
		} else if (byte >= 32 && byte <= 246) {
			operands.push(byte - 139);
		} else if (byte >= 247 && byte <= 250) {
			operands.push((byte - 247) * 256 + view.getUint8(cursor) + 108);
			cursor += 1;
		} else if (byte >= 251 && byte <= 254) {
			operands.push(-(byte - 251) * 256 - view.getUint8(cursor) - 108);
			cursor += 1;
		}
	}
	return dictionary;
}

function skipReal(view: DataView, start: number): number {
	let cursor = start;
	for (;;) {
		const byte = view.getUint8(cursor);
		cursor += 1;
		if (byte >> 4 === 0xf || (byte & 0xf) === 0xf) return cursor;
	}
}

function subroutineBias(count: number): number {
	if (count < 1240) return 107;
	if (count < 33900) return 1131;
	return 32768;
}

/** Interprets one charstring into path commands; coordinates are font units, y up. */
class Interpreter {
	private readonly stack: number[] = [];
	private x = 0;
	private y = 0;
	private stems = 0;
	private widthParsed = false;
	private open = false;
	private done = false;
	readonly commands: PathCommand[] = [];

	constructor(
		private readonly view: DataView,
		private readonly globalSubrs: readonly Range[],
		private readonly localSubrs: readonly Range[]
	) {}

	run(range: Range, depth = 0): void {
		if (depth > MAX_CALL_DEPTH) return;
		let cursor = range.start;
		while (cursor < range.end && !this.done) {
			const byte = this.view.getUint8(cursor);
			cursor += 1;
			if (byte >= 32 || byte === 28) {
				cursor = this.pushNumber(byte, cursor);
				continue;
			}
			if (byte === 12) {
				this.escape(this.view.getUint8(cursor));
				cursor += 1;
				continue;
			}
			if (byte === 10 || byte === 29) {
				this.call(byte === 10 ? this.localSubrs : this.globalSubrs, depth);
				continue;
			}
			if (byte === 11) return;
			cursor = this.operator(byte, cursor);
		}
	}

	finish(): void {
		if (this.open) this.commands.push({ op: 'close' });
		this.open = false;
	}

	private pushNumber(byte: number, start: number): number {
		let cursor = start;
		let value: number;
		if (byte === 28) {
			value = this.view.getInt16(cursor);
			cursor += 2;
		} else if (byte <= 246) {
			value = byte - 139;
		} else if (byte <= 250) {
			value = (byte - 247) * 256 + this.view.getUint8(cursor) + 108;
			cursor += 1;
		} else if (byte <= 254) {
			value = -(byte - 251) * 256 - this.view.getUint8(cursor) - 108;
			cursor += 1;
		} else {
			value = this.view.getInt32(cursor) / 65536;
			cursor += 4;
		}
		if (this.stack.length < MAX_STACK) this.stack.push(value);
		return cursor;
	}

	private call(subrs: readonly Range[], depth: number): void {
		const index = (this.stack.pop() ?? 0) + subroutineBias(subrs.length);
		const target = subrs[index];
		if (target) this.run(target, depth + 1);
	}

	/** The optional width operand is the first argument of the first stack clearing operator. */
	private takeWidth(expected: number | 'even'): void {
		if (this.widthParsed) return;
		this.widthParsed = true;
		const extra = expected === 'even' ? this.stack.length % 2 === 1 : this.stack.length > expected;
		if (extra) this.stack.shift();
	}

	private operator(byte: number, start: number): number {
		let cursor = start;
		switch (byte) {
			case 1:
			case 3:
			case 18:
			case 23:
				this.takeWidth('even');
				this.stems += this.stack.length / 2;
				this.stack.length = 0;
				break;
			case 19:
			case 20:
				this.takeWidth('even');
				this.stems += this.stack.length / 2;
				this.stack.length = 0;
				cursor += Math.ceil(this.stems / 8);
				break;
			case 21:
				this.takeWidth(2);
				this.move(this.stack[0] ?? 0, this.stack[1] ?? 0);
				break;
			case 22:
				this.takeWidth(1);
				this.move(this.stack[0] ?? 0, 0);
				break;
			case 4:
				this.takeWidth(1);
				this.move(0, this.stack[0] ?? 0);
				break;
			case 5:
				this.lines(false, true);
				break;
			case 6:
				this.lines(true, false);
				break;
			case 7:
				this.lines(false, false);
				break;
			case 8:
				this.curves();
				break;
			case 24:
				this.curveThenLine();
				break;
			case 25:
				this.lineThenCurve();
				break;
			case 26:
				this.verticalCurves();
				break;
			case 27:
				this.horizontalCurves();
				break;
			case 30:
				this.alternatingCurves(false);
				break;
			case 31:
				this.alternatingCurves(true);
				break;
			case 14:
				this.takeWidth(0);
				this.finish();
				this.done = true;
				break;
			default:
				this.stack.length = 0;
		}
		return cursor;
	}

	private move(deltaX: number, deltaY: number): void {
		this.finish();
		this.x += deltaX;
		this.y += deltaY;
		this.commands.push({ op: 'move', x: this.x, y: this.y });
		this.open = true;
		this.stack.length = 0;
	}

	private lineBy(deltaX: number, deltaY: number): void {
		this.x += deltaX;
		this.y += deltaY;
		this.commands.push({ op: 'line', x: this.x, y: this.y });
	}

	private curveBy(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
		const startX = this.x;
		const startY = this.y;
		const control1X = startX + x1;
		const control1Y = startY + y1;
		const control2X = control1X + x2;
		const control2Y = control1Y + y2;
		this.x = control2X + x3;
		this.y = control2Y + y3;
		this.commands.push({
			op: 'cubic',
			x1: control1X,
			y1: control1Y,
			x2: control2X,
			y2: control2Y,
			x: this.x,
			y: this.y
		});
	}

	/** rlineto (both axes) or the alternating hlineto / vlineto. */
	private lines(horizontalFirst: boolean, both: boolean): void {
		const args = this.stack;
		if (both) {
			for (let index = 0; index + 1 < args.length; index += 2)
				this.lineBy(args[index], args[index + 1]);
		} else {
			let horizontal = horizontalFirst;
			for (const value of args) {
				if (horizontal) this.lineBy(value, 0);
				else this.lineBy(0, value);
				horizontal = !horizontal;
			}
		}
		args.length = 0;
	}

	private curves(): void {
		const a = this.stack;
		for (let index = 0; index + 5 < a.length; index += 6) {
			this.curveBy(a[index], a[index + 1], a[index + 2], a[index + 3], a[index + 4], a[index + 5]);
		}
		a.length = 0;
	}

	private curveThenLine(): void {
		const a = this.stack;
		let index = 0;
		for (; index + 7 < a.length; index += 6) {
			this.curveBy(a[index], a[index + 1], a[index + 2], a[index + 3], a[index + 4], a[index + 5]);
		}
		this.lineBy(a[index] ?? 0, a[index + 1] ?? 0);
		a.length = 0;
	}

	private lineThenCurve(): void {
		const a = this.stack;
		let index = 0;
		for (; index + 7 < a.length; index += 2) this.lineBy(a[index], a[index + 1]);
		this.curveBy(a[index], a[index + 1], a[index + 2], a[index + 3], a[index + 4], a[index + 5]);
		a.length = 0;
	}

	private verticalCurves(): void {
		const a = this.stack;
		let index = 0;
		let extraX = 0;
		if (a.length % 4 === 1) {
			extraX = a[0];
			index = 1;
		}
		for (; index + 3 < a.length; index += 4) {
			this.curveBy(extraX, a[index], a[index + 1], a[index + 2], 0, a[index + 3]);
			extraX = 0;
		}
		a.length = 0;
	}

	private horizontalCurves(): void {
		const a = this.stack;
		let index = 0;
		let extraY = 0;
		if (a.length % 4 === 1) {
			extraY = a[0];
			index = 1;
		}
		for (; index + 3 < a.length; index += 4) {
			this.curveBy(a[index], extraY, a[index + 1], a[index + 2], a[index + 3], 0);
			extraY = 0;
		}
		a.length = 0;
	}

	/** hvcurveto (`horizontalStart`) and vhcurveto: curves that start and end on alternating axes. */
	private alternatingCurves(horizontalStart: boolean): void {
		const a = this.stack;
		let horizontal = horizontalStart;
		let index = 0;
		while (index + 3 < a.length) {
			const last = a.length - index === 5 ? a[index + 4] : 0;
			if (horizontal) {
				this.curveBy(a[index], 0, a[index + 1], a[index + 2], last, a[index + 3]);
			} else {
				this.curveBy(0, a[index], a[index + 1], a[index + 2], a[index + 3], last);
			}
			horizontal = !horizontal;
			index += 4;
		}
		a.length = 0;
	}

	private escape(code: number): void {
		const a = this.stack;
		if (code === 35 && a.length >= 12) {
			this.curveBy(a[0], a[1], a[2], a[3], a[4], a[5]);
			this.curveBy(a[6], a[7], a[8], a[9], a[10], a[11]);
		} else if (code === 34 && a.length >= 7) {
			this.curveBy(a[0], 0, a[1], a[2], a[3], 0);
			this.curveBy(a[4], 0, a[5], -a[2], a[6], 0);
		} else if (code === 36 && a.length >= 9) {
			this.curveBy(a[0], a[1], a[2], a[3], a[4], 0);
			this.curveBy(a[5], 0, a[6], a[7], a[8], -(a[1] + a[3] + a[7]));
		} else if (code === 37 && a.length >= 11) {
			const sumX = a[0] + a[2] + a[4] + a[6] + a[8];
			const sumY = a[1] + a[3] + a[5] + a[7] + a[9];
			this.curveBy(a[0], a[1], a[2], a[3], a[4], a[5]);
			if (Math.abs(sumX) > Math.abs(sumY)) {
				this.curveBy(a[6], a[7], a[8], a[9], a[10], -sumY);
			} else {
				this.curveBy(a[6], a[7], a[8], a[9], -sumX, a[10]);
			}
		}
		a.length = 0;
	}
}

export class CffOutlines {
	private constructor(
		private readonly view: DataView,
		private readonly charStrings: readonly Range[],
		private readonly globalSubrs: readonly Range[],
		private readonly localSubrs: readonly Range[]
	) {}

	get glyphCount(): number {
		return this.charStrings.length;
	}

	/** `table` is the whole font file; `offset` where the `CFF ` table starts. */
	static parse(view: DataView, offset: number): CffOutlines | null {
		const headerSize = view.getUint8(offset + 2);
		const names = readIndex(view, offset + headerSize);
		const topDicts = readIndex(view, names.end);
		const strings = readIndex(view, topDicts.end);
		const globalSubrs = readIndex(view, strings.end);
		if (topDicts.items.length === 0) return null;
		const top = readDictionary(view, topDicts.items[0]);
		if (top.has(OP_ROS)) return null;
		const charStringsOffset = top.get(OP_CHARSTRINGS)?.[0];
		if (charStringsOffset === undefined) return null;
		const charStrings = readIndex(view, offset + charStringsOffset).items;
		const localSubrs = readLocalSubrs(view, offset, top);
		return new CffOutlines(view, charStrings, globalSubrs.items, localSubrs);
	}

	/** Path commands of a glyph, font units, y up; empty for an unknown glyph. */
	glyphCommands(glyphId: number): PathCommand[] {
		const range = this.charStrings[glyphId];
		if (!range) return [];
		const interpreter = new Interpreter(this.view, this.globalSubrs, this.localSubrs);
		try {
			interpreter.run(range);
		} catch {
			return [];
		}
		interpreter.finish();
		return interpreter.commands;
	}
}

function readLocalSubrs(view: DataView, tableOffset: number, top: Dictionary): Range[] {
	const privateEntry = top.get(OP_PRIVATE);
	if (!privateEntry || privateEntry.length < 2) return [];
	const [size, start] = privateEntry;
	const privateStart = tableOffset + start;
	const privateDict = readDictionary(view, { start: privateStart, end: privateStart + size });
	const subrsOffset = privateDict.get(OP_SUBRS)?.[0];
	if (subrsOffset === undefined) return [];
	return readIndex(view, privateStart + subrsOffset).items;
}
