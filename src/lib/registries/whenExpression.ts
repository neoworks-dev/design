// Context-key expressions used by `when` clauses of commands and key bindings:
//
//   hasSelection
//   canvasFocus && !textEditing
//   selectionKind == frame || selectionKind == 'component'
//   !(textEditing || inputFocus)
//
// A bare identifier on the left of `==` / `!=` (or alone) is looked up as a context key; on the
// right of a comparison it is a literal (`selectionKind == frame` compares with the string
// "frame"). Quoted strings and numbers are literals everywhere. The result is truthiness.
// Pure: no kernel, no Svelte.

export class WhenExpressionError extends Error {
	constructor(
		readonly expression: string,
		reason: string
	) {
		super(`invalid when expression "${expression}": ${reason}`);
		this.name = 'WhenExpressionError';
	}
}

type Operand = { kind: 'key'; name: string } | { kind: 'literal'; value: string | number };

type WhenNode =
	| Operand
	| { kind: 'not'; operand: WhenNode }
	| { kind: 'and' | 'or'; left: WhenNode; right: WhenNode }
	| { kind: 'equals' | 'notEquals'; left: Operand; right: Operand };

export type LookupKey = (name: string) => unknown;

const parsedCache = new Map<string, WhenNode>();

/** Throws WhenExpressionError when `expression` is malformed. */
export function validateWhenExpression(expression: string): void {
	parseWhenExpression(expression);
}

export function evaluateWhenExpression(expression: string, lookup: LookupKey): boolean {
	return Boolean(evaluateNode(parseWhenExpression(expression), lookup));
}

function parseWhenExpression(expression: string): WhenNode {
	const cached = parsedCache.get(expression);
	if (cached) return cached;
	const parser = new Parser(expression);
	const node = parser.parse();
	parsedCache.set(expression, node);
	return node;
}

function resolveOperand(operand: Operand, lookup: LookupKey): unknown {
	if (operand.kind === 'literal') return operand.value;
	return lookup(operand.name);
}

function evaluateNode(node: WhenNode, lookup: LookupKey): unknown {
	switch (node.kind) {
		case 'key':
		case 'literal':
			return resolveOperand(node, lookup);
		case 'not':
			return !evaluateNode(node.operand, lookup);
		case 'and':
			return evaluateNode(node.left, lookup) && evaluateNode(node.right, lookup);
		case 'or':
			return evaluateNode(node.left, lookup) || evaluateNode(node.right, lookup);
		case 'equals':
			return looseEquals(resolveOperand(node.left, lookup), resolveOperand(node.right, lookup));
		case 'notEquals':
			return !looseEquals(resolveOperand(node.left, lookup), resolveOperand(node.right, lookup));
	}
}

// Context values are often booleans or numbers while the expression literal is text.
function looseEquals(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	const primitive =
		typeof left === 'string' || typeof left === 'number' || typeof left === 'boolean';
	if (!primitive) return false;
	return String(left) === String(right);
}

type Token = { type: 'word' | 'string' | 'number' | 'operator'; text: string };

const OPERATORS = ['&&', '||', '==', '!=', '!', '(', ')'];
const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_.\-:]/;

function tokenize(expression: string): Token[] {
	const tokens: Token[] = [];
	let position = 0;
	while (position < expression.length) {
		const char = expression[position];
		if (/\s/.test(char)) {
			position += 1;
			continue;
		}
		const operator = OPERATORS.find((candidate) => expression.startsWith(candidate, position));
		if (operator) {
			tokens.push({ type: 'operator', text: operator });
			position += operator.length;
			continue;
		}
		if (char === "'" || char === '"') {
			const end = expression.indexOf(char, position + 1);
			if (end < 0) throw new WhenExpressionError(expression, 'unterminated string');
			tokens.push({ type: 'string', text: expression.slice(position + 1, end) });
			position = end + 1;
			continue;
		}
		if (/[0-9]/.test(char)) {
			let end = position;
			while (end < expression.length && /[0-9.]/.test(expression[end])) end += 1;
			tokens.push({ type: 'number', text: expression.slice(position, end) });
			position = end;
			continue;
		}
		if (WORD_START.test(char)) {
			let end = position;
			while (end < expression.length && WORD_PART.test(expression[end])) end += 1;
			tokens.push({ type: 'word', text: expression.slice(position, end) });
			position = end;
			continue;
		}
		throw new WhenExpressionError(expression, `unexpected character "${char}"`);
	}
	return tokens;
}

class Parser {
	#tokens: Token[];
	#position = 0;

	constructor(private readonly expression: string) {
		this.#tokens = tokenize(expression);
	}

	parse(): WhenNode {
		if (this.#tokens.length === 0) throw new WhenExpressionError(this.expression, 'empty');
		const node = this.#parseOr();
		if (this.#position < this.#tokens.length) {
			throw new WhenExpressionError(
				this.expression,
				`unexpected "${this.#tokens[this.#position].text}"`
			);
		}
		return node;
	}

	#peekOperator(text: string): boolean {
		const token = this.#tokens[this.#position];
		return token !== undefined && token.type === 'operator' && token.text === text;
	}

	#parseOr(): WhenNode {
		let left = this.#parseAnd();
		while (this.#peekOperator('||')) {
			this.#position += 1;
			left = { kind: 'or', left, right: this.#parseAnd() };
		}
		return left;
	}

	#parseAnd(): WhenNode {
		let left = this.#parseNot();
		while (this.#peekOperator('&&')) {
			this.#position += 1;
			left = { kind: 'and', left, right: this.#parseNot() };
		}
		return left;
	}

	#parseNot(): WhenNode {
		if (!this.#peekOperator('!')) return this.#parseComparison();
		this.#position += 1;
		return { kind: 'not', operand: this.#parseNot() };
	}

	#parseComparison(): WhenNode {
		if (this.#peekOperator('(')) return this.#parseGroup();
		const left = this.#parseOperand(false);
		const equals = this.#peekOperator('==');
		const notEquals = this.#peekOperator('!=');
		if (!equals && !notEquals) return left;
		this.#position += 1;
		const right = this.#parseOperand(true);
		return { kind: equals ? 'equals' : 'notEquals', left, right };
	}

	#parseGroup(): WhenNode {
		this.#position += 1;
		const inner = this.#parseOr();
		if (!this.#peekOperator(')')) throw new WhenExpressionError(this.expression, 'missing ")"');
		this.#position += 1;
		return inner;
	}

	#parseOperand(wordIsLiteral: boolean): Operand {
		const token = this.#tokens[this.#position];
		if (!token) throw new WhenExpressionError(this.expression, 'unexpected end');
		if (token.type === 'operator') {
			throw new WhenExpressionError(this.expression, `unexpected "${token.text}"`);
		}
		this.#position += 1;
		if (token.type === 'string') return { kind: 'literal', value: token.text };
		if (token.type === 'number') return { kind: 'literal', value: Number(token.text) };
		if (wordIsLiteral) return { kind: 'literal', value: token.text };
		return { kind: 'key', name: token.text };
	}
}
