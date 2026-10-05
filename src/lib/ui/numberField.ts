// Pure logic of the numeric inspector field: expression input, stepping and formatting. No
// Svelte, so it is unit-tested directly.

/** How a change came about: typed and committed, dragged over the label, or Up/Down. */
export type NumberGesture = 'commit' | 'scrub' | 'step';

type Token = { kind: 'number'; value: number } | { kind: 'symbol'; value: string };

function tokenize(text: string): Token[] | null {
	const tokens: Token[] = [];
	let position = 0;
	while (position < text.length) {
		const character = text[position];
		if (character === ' ') {
			position += 1;
			continue;
		}
		if ('+-*/()'.includes(character)) {
			tokens.push({ kind: 'symbol', value: character });
			position += 1;
			continue;
		}
		const match = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(position));
		if (match === null) return null;
		tokens.push({ kind: 'number', value: Number(match[1]) });
		position += match[1].length;
	}
	return tokens;
}

class ExpressionParser {
	private position = 0;

	constructor(private readonly tokens: Token[]) {}

	parse(): number | null {
		const value = this.sum();
		if (value === null) return null;
		if (this.position !== this.tokens.length) return null;
		return value;
	}

	private peek(): Token | undefined {
		return this.tokens[this.position];
	}

	private takeSymbol(symbols: string): string | null {
		const token = this.peek();
		if (token === undefined || token.kind !== 'symbol') return null;
		if (!symbols.includes(token.value)) return null;
		this.position += 1;
		return token.value;
	}

	private sum(): number | null {
		let value = this.product();
		while (value !== null) {
			const operator = this.takeSymbol('+-');
			if (operator === null) return value;
			const right = this.product();
			if (right === null) return null;
			if (operator === '+') value += right;
			else value -= right;
		}
		return null;
	}

	private product(): number | null {
		let value = this.unary();
		while (value !== null) {
			const operator = this.takeSymbol('*/');
			if (operator === null) return value;
			const right = this.unary();
			if (right === null) return null;
			if (operator === '*') value *= right;
			else value /= right;
		}
		return null;
	}

	private unary(): number | null {
		if (this.takeSymbol('-') !== null) {
			const value = this.unary();
			if (value === null) return null;
			return -value;
		}
		if (this.takeSymbol('+') !== null) return this.unary();
		return this.atom();
	}

	private atom(): number | null {
		const token = this.peek();
		if (token === undefined) return null;
		if (token.kind === 'number') {
			this.position += 1;
			return token.value;
		}
		if (this.takeSymbol('(') === null) return null;
		const value = this.sum();
		if (value === null) return null;
		if (this.takeSymbol(')') === null) return null;
		return value;
	}
}

/** Evaluate `10+5`, `2*(3+1)`, `-4`. Anything else (letters, empty input) is `null`. */
export function evaluateExpression(text: string): number | null {
	const tokens = tokenize(text);
	if (tokens === null || tokens.length === 0) return null;
	const value = new ExpressionParser(tokens).parse();
	if (value === null || !Number.isFinite(value)) return null;
	return value;
}

function stripUnit(text: string, unit: string): string {
	const trimmed = text.trim();
	if (unit === '' || !trimmed.endsWith(unit)) return trimmed;
	return trimmed.slice(0, trimmed.length - unit.length);
}

/**
 * The number a typed text means, or `null` when it is not valid. A leading `*` or `/` works on
 * the current value (`*2` doubles it); a trailing unit is accepted.
 */
export function parseFieldText(text: string, current: number | null, unit = ''): number | null {
	const body = stripUnit(text, unit).trim();
	if (body === '') return null;
	if (body.startsWith('*') || body.startsWith('/')) {
		if (current === null) return null;
		return evaluateExpression(`${current}${body}`);
	}
	return evaluateExpression(body);
}

export function clampValue(value: number, min?: number, max?: number): number {
	let result = value;
	if (min !== undefined && result < min) result = min;
	if (max !== undefined && result > max) result = max;
	return result;
}

/** Shown precision: at most `precision` decimals, no trailing zeros. */
export function formatNumber(value: number, precision = 2): string {
	const factor = 10 ** precision;
	const rounded = Math.round(value * factor) / factor;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

export interface StepModifiers {
	shift: boolean;
	alt: boolean;
}

/** Size of one Up/Down press or one scrubbed pixel: `step`, x10 with Shift, /10 with Alt. */
export function stepSize(step: number, modifiers: StepModifiers): number {
	if (modifiers.shift) return step * 10;
	if (modifiers.alt) return step / 10;
	return step;
}

/** `value` moved by `amount`, without float noise (`0.1 + 0.2`). */
export function stepValue(value: number, amount: number, precision = 2): number {
	const factor = 10 ** (precision + 1);
	return Math.round((value + amount) * factor) / factor;
}
