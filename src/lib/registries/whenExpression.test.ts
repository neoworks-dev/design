import { describe, expect, it } from 'vitest';
import {
	evaluateWhenExpression,
	validateWhenExpression,
	WhenExpressionError
} from './whenExpression';

function evaluate(expression: string, keys: Record<string, unknown>): boolean {
	return evaluateWhenExpression(expression, (name) => keys[name]);
}

describe('when expressions', () => {
	it('reads a bare key as truthiness', () => {
		expect(evaluate('hasSelection', { hasSelection: true })).toBe(true);
		expect(evaluate('hasSelection', { hasSelection: false })).toBe(false);
		expect(evaluate('hasSelection', {})).toBe(false);
	});

	it('supports not, and, or with the usual precedence', () => {
		const keys = { a: true, b: false, c: true };
		expect(evaluate('!b', keys)).toBe(true);
		expect(evaluate('a && b', keys)).toBe(false);
		expect(evaluate('a || b && b', keys)).toBe(true);
		expect(evaluate('(a || b) && b', keys)).toBe(false);
		expect(evaluate('!(a && b) && c', keys)).toBe(true);
	});

	it('compares with a bare word literal on the right', () => {
		expect(evaluate('selectionKind == frame', { selectionKind: 'frame' })).toBe(true);
		expect(evaluate('selectionKind == frame', { selectionKind: 'text' })).toBe(false);
		expect(evaluate('selectionKind != frame', { selectionKind: 'text' })).toBe(true);
		expect(evaluate('selectionKind != frame', {})).toBe(true);
	});

	it('compares with quoted strings and numbers', () => {
		expect(evaluate("kind == 'auto layout'", { kind: 'auto layout' })).toBe(true);
		expect(evaluate('count == 2', { count: 2 })).toBe(true);
		expect(evaluate('count == 2', { count: 3 })).toBe(false);
	});

	it('does not treat an unset key as equal to a literal', () => {
		expect(evaluate('selectionKind == frame', {})).toBe(false);
	});

	it('rejects malformed expressions', () => {
		for (const expression of ['', 'a &&', '(a', 'a b', 'a == ', "a == 'x", 'a @ b']) {
			expect(() => validateWhenExpression(expression), expression).toThrow(WhenExpressionError);
		}
	});
});
