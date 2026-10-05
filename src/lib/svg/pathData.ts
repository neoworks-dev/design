// SVG path data (`d`) to path commands (#106): absolute moves, lines, cubics and closes only.
// Relative commands, H/V, smooth curves, quadratics and elliptical arcs are all converted.

import type { PathCommand } from '../document/outline';

const ARGUMENTS: Record<string, number> = {
	m: 2,
	l: 2,
	h: 1,
	v: 1,
	c: 6,
	s: 4,
	q: 4,
	t: 2,
	a: 7,
	z: 0
};

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const FLAG = /[01]/y;

class Reader {
	private position = 0;

	constructor(private readonly source: string) {}

	private skipSeparators(): void {
		while (this.position < this.source.length && /[\s,]/.test(this.source[this.position])) {
			this.position += 1;
		}
	}

	atEnd(): boolean {
		this.skipSeparators();
		return this.position >= this.source.length;
	}

	/** The next command letter, or undefined when the next token is a number. */
	letter(): string | undefined {
		this.skipSeparators();
		const char = this.source[this.position];
		if (char !== undefined && /[a-zA-Z]/.test(char)) {
			this.position += 1;
			return char;
		}
		return undefined;
	}

	number(): number | null {
		this.skipSeparators();
		NUMBER.lastIndex = this.position;
		const match = NUMBER.exec(this.source);
		if (match === null) return null;
		this.position = NUMBER.lastIndex;
		return Number(match[0]);
	}

	/** Arc flags are single digits and may be written without separators. */
	flag(): number | null {
		this.skipSeparators();
		FLAG.lastIndex = this.position;
		const match = FLAG.exec(this.source);
		if (match === null) return null;
		this.position = FLAG.lastIndex;
		return Number(match[0]);
	}
}

interface Cursor {
	x: number;
	y: number;
	startX: number;
	startY: number;
	/** The previous cubic's second control point, for `S`. */
	cubicControl: { x: number; y: number } | null;
	/** The previous quadratic's control point, for `T`. */
	quadraticControl: { x: number; y: number } | null;
}

function readArguments(reader: Reader, command: string): number[] | null {
	const count = ARGUMENTS[command.toLowerCase()];
	const values: number[] = [];
	for (let index = 0; index < count; index += 1) {
		const isFlag = command.toLowerCase() === 'a' && (index === 3 || index === 4);
		const value = isFlag ? reader.flag() : reader.number();
		if (value === null) return null;
		values.push(value);
	}
	return values;
}

function quadraticToCubic(
	from: { x: number; y: number },
	control: { x: number; y: number },
	to: { x: number; y: number }
): PathCommand {
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

/** SVG implementation notes F.6: an endpoint arc as cubic segments of at most a quarter turn. */
function arcToCubics(
	fromX: number,
	fromY: number,
	radiusXInput: number,
	radiusYInput: number,
	rotationDegrees: number,
	largeArc: boolean,
	sweep: boolean,
	toX: number,
	toY: number
): PathCommand[] {
	let radiusX = Math.abs(radiusXInput);
	let radiusY = Math.abs(radiusYInput);
	if (radiusX === 0 || radiusY === 0 || (fromX === toX && fromY === toY)) {
		return [{ op: 'line', x: toX, y: toY }];
	}
	const phi = (rotationDegrees * Math.PI) / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);
	const halfX = (fromX - toX) / 2;
	const halfY = (fromY - toY) / 2;
	const x1 = cosPhi * halfX + sinPhi * halfY;
	const y1 = -sinPhi * halfX + cosPhi * halfY;
	const lambda = (x1 * x1) / (radiusX * radiusX) + (y1 * y1) / (radiusY * radiusY);
	if (lambda > 1) {
		radiusX *= Math.sqrt(lambda);
		radiusY *= Math.sqrt(lambda);
	}
	const numerator =
		radiusX * radiusX * radiusY * radiusY -
		radiusX * radiusX * y1 * y1 -
		radiusY * radiusY * x1 * x1;
	const denominator = radiusX * radiusX * y1 * y1 + radiusY * radiusY * x1 * x1;
	let factor = Math.sqrt(Math.max(0, numerator / denominator));
	if (largeArc === sweep) factor = -factor;
	const centerXPrime = (factor * radiusX * y1) / radiusY;
	const centerYPrime = (-factor * radiusY * x1) / radiusX;
	const centerX = cosPhi * centerXPrime - sinPhi * centerYPrime + (fromX + toX) / 2;
	const centerY = sinPhi * centerXPrime + cosPhi * centerYPrime + (fromY + toY) / 2;
	const startAngle = Math.atan2((y1 - centerYPrime) / radiusY, (x1 - centerXPrime) / radiusX);
	const endAngle = Math.atan2((-y1 - centerYPrime) / radiusY, (-x1 - centerXPrime) / radiusX);
	let delta = endAngle - startAngle;
	if (sweep && delta < 0) delta += Math.PI * 2;
	if (!sweep && delta > 0) delta -= Math.PI * 2;
	const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
	const step = delta / segments;
	const reach = (4 / 3) * Math.tan(step / 4);
	const commands: PathCommand[] = [];
	const point = (angle: number): { x: number; y: number; dx: number; dy: number } => {
		const cosA = Math.cos(angle);
		const sinA = Math.sin(angle);
		return {
			x: centerX + radiusX * cosA * cosPhi - radiusY * sinA * sinPhi,
			y: centerY + radiusX * cosA * sinPhi + radiusY * sinA * cosPhi,
			dx: -radiusX * sinA * cosPhi - radiusY * cosA * sinPhi,
			dy: -radiusX * sinA * sinPhi + radiusY * cosA * cosPhi
		};
	};
	for (let index = 0; index < segments; index += 1) {
		const start = point(startAngle + index * step);
		const end = point(startAngle + (index + 1) * step);
		commands.push({
			op: 'cubic',
			x1: start.x + reach * start.dx,
			y1: start.y + reach * start.dy,
			x2: end.x - reach * end.dx,
			y2: end.y - reach * end.dy,
			x: index === segments - 1 ? toX : end.x,
			y: index === segments - 1 ? toY : end.y
		});
	}
	return commands;
}

function reflect(
	control: { x: number; y: number } | null,
	about: { x: number; y: number }
): { x: number; y: number } {
	if (control === null) return { x: about.x, y: about.y };
	return { x: 2 * about.x - control.x, y: 2 * about.y - control.y };
}

function apply(
	command: string,
	values: number[],
	cursor: Cursor,
	output: PathCommand[],
	firstOfMove: boolean
): void {
	const relative = command === command.toLowerCase();
	const baseX = relative ? cursor.x : 0;
	const baseY = relative ? cursor.y : 0;
	const letter = command.toLowerCase();
	let cubicControl: Cursor['cubicControl'] = null;
	let quadraticControl: Cursor['quadraticControl'] = null;
	const from = { x: cursor.x, y: cursor.y };
	if (letter === 'm' && firstOfMove) {
		cursor.x = baseX + values[0];
		cursor.y = baseY + values[1];
		cursor.startX = cursor.x;
		cursor.startY = cursor.y;
		output.push({ op: 'move', x: cursor.x, y: cursor.y });
	} else if (letter === 'm' || letter === 'l') {
		cursor.x = baseX + values[0];
		cursor.y = baseY + values[1];
		output.push({ op: 'line', x: cursor.x, y: cursor.y });
	} else if (letter === 'h') {
		cursor.x = baseX + values[0];
		output.push({ op: 'line', x: cursor.x, y: cursor.y });
	} else if (letter === 'v') {
		cursor.y = baseY + values[0];
		output.push({ op: 'line', x: cursor.x, y: cursor.y });
	} else if (letter === 'c' || letter === 's') {
		const smooth = letter === 's';
		const offset = smooth ? 0 : 2;
		const first = smooth
			? reflect(cursor.cubicControl, from)
			: { x: baseX + values[0], y: baseY + values[1] };
		const second = { x: baseX + values[offset], y: baseY + values[offset + 1] };
		const end = { x: baseX + values[offset + 2], y: baseY + values[offset + 3] };
		output.push({ op: 'cubic', x1: first.x, y1: first.y, x2: second.x, y2: second.y, ...end });
		cubicControl = second;
		cursor.x = end.x;
		cursor.y = end.y;
	} else if (letter === 'q' || letter === 't') {
		const control =
			letter === 'q'
				? { x: baseX + values[0], y: baseY + values[1] }
				: reflect(cursor.quadraticControl, from);
		const offset = letter === 'q' ? 2 : 0;
		const end = { x: baseX + values[offset], y: baseY + values[offset + 1] };
		output.push(quadraticToCubic(from, control, end));
		quadraticControl = control;
		cursor.x = end.x;
		cursor.y = end.y;
	} else if (letter === 'a') {
		const endX = baseX + values[5];
		const endY = baseY + values[6];
		output.push(
			...arcToCubics(
				from.x,
				from.y,
				values[0],
				values[1],
				values[2],
				values[3] !== 0,
				values[4] !== 0,
				endX,
				endY
			)
		);
		cursor.x = endX;
		cursor.y = endY;
	}
	cursor.cubicControl = cubicControl;
	cursor.quadraticControl = quadraticControl;
}

/** The commands of `d`; parsing stops at the first malformed command, keeping what came before. */
export function parsePathData(d: string): PathCommand[] {
	const reader = new Reader(d);
	const output: PathCommand[] = [];
	const cursor: Cursor = {
		x: 0,
		y: 0,
		startX: 0,
		startY: 0,
		cubicControl: null,
		quadraticControl: null
	};
	let command: string | undefined;
	let first = true;
	while (!reader.atEnd()) {
		const letter = reader.letter();
		if (letter !== undefined) {
			if (ARGUMENTS[letter.toLowerCase()] === undefined) break;
			if (output.length === 0 && letter.toLowerCase() !== 'm') break;
			command = letter;
			first = true;
			if (letter.toLowerCase() === 'z') {
				output.push({ op: 'close' });
				cursor.x = cursor.startX;
				cursor.y = cursor.startY;
				cursor.cubicControl = null;
				cursor.quadraticControl = null;
				continue;
			}
		}
		if (command === undefined || command.toLowerCase() === 'z') break;
		const values = readArguments(reader, command);
		if (values === null) break;
		apply(command, values, cursor, output, first);
		first = false;
	}
	return output;
}
