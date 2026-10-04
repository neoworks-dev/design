import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	compareSiblings,
	isValidIndex,
	keyBetween,
	keysBetween,
	rebalancedKeys
} from './fractionalIndex';

function isStrictlyAscending(keys: string[]): boolean {
	for (let position = 1; position < keys.length; position += 1) {
		if (keys[position - 1] >= keys[position]) return false;
	}
	return true;
}

describe('keyBetween', () => {
	it('starts at a0', () => {
		expect(keyBetween(null, null)).toBe('a0');
	});

	it('appends and prepends', () => {
		expect(keyBetween('a0', null)).toBe('a1');
		expect(keyBetween(null, 'a0')).toBe('Zz');
		expect(keyBetween('a9', null)).toBe('aA');
		expect(keyBetween('az', null)).toBe('b00');
	});

	it('finds a key between neighbours', () => {
		expect(keyBetween('a0', 'a1')).toBe('a0V');
		expect(keyBetween('a0', 'a0V')).toBe('a0G');
		expect(keyBetween('a1', 'a2')).toBe('a1V');
	});

	it('rejects unordered or invalid input', () => {
		expect(() => keyBetween('a1', 'a0')).toThrow();
		expect(() => keyBetween('a1', 'a1')).toThrow();
		expect(() => keyBetween('a10', null)).toThrow();
		expect(() => keyBetween('!', null)).toThrow();
		expect(isValidIndex('a0')).toBe(true);
		expect(isValidIndex('a00')).toBe(false);
		expect(isValidIndex('')).toBe(false);
	});

	it('always produces a valid key strictly between any two keys built by random operations', () => {
		const operation = fc.array(fc.tuple(fc.nat(), fc.constantFrom('before', 'after', 'between')), {
			minLength: 1,
			maxLength: 80
		});
		fc.assert(
			fc.property(operation, (operations) => {
				const keys: string[] = [];
				for (const [seed, kind] of operations) {
					const slot = keys.length === 0 ? 0 : seed % keys.length;
					if (keys.length === 0) {
						keys.push(keyBetween(null, null));
					} else if (kind === 'before') {
						keys.unshift(keyBetween(null, keys[0]));
					} else if (kind === 'after') {
						keys.push(keyBetween(keys[keys.length - 1], null));
					} else if (slot + 1 < keys.length) {
						keys.splice(slot + 1, 0, keyBetween(keys[slot], keys[slot + 1]));
					}
					if (!isStrictlyAscending(keys)) return false;
				}
				return keys.every(isValidIndex);
			}),
			{ numRuns: 300 }
		);
	});

	it('survives 500 inserts at the same spot with only linear key growth', () => {
		const first = keyBetween(null, null);
		let upper = keyBetween(first, null);
		const keys = [first, upper];
		for (let count = 0; count < 500; count += 1) {
			upper = keyBetween(first, upper);
			keys.splice(1, 0, upper);
		}
		expect(isStrictlyAscending(keys)).toBe(true);
		expect(upper.length).toBeLessThan(500);
	});

	it('handles very long runs of appends and prepends', () => {
		let key = keyBetween(null, null);
		const appended = [key];
		for (let count = 0; count < 1000; count += 1) {
			key = keyBetween(key, null);
			appended.push(key);
		}
		expect(isStrictlyAscending(appended)).toBe(true);
		let first = appended[0];
		const prepended = [first];
		for (let count = 0; count < 1000; count += 1) {
			first = keyBetween(null, first);
			prepended.unshift(first);
		}
		expect(isStrictlyAscending(prepended)).toBe(true);
	});
});

describe('keysBetween', () => {
	it('returns nothing for zero and one key for one', () => {
		expect(keysBetween(null, null, 0)).toEqual([]);
		expect(keysBetween('a0', 'a1', 1)).toEqual([keyBetween('a0', 'a1')]);
	});

	it('returns n ascending valid keys inside the bounds', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 200 }), fc.constantFrom(0, 1, 2, 3), (count, shape) => {
				const lower = shape === 1 || shape === 3 ? 'a5' : null;
				const upper = shape === 2 || shape === 3 ? 'a6' : null;
				const keys = keysBetween(lower, upper, count);
				if (keys.length !== count) return false;
				if (!isStrictlyAscending(keys)) return false;
				if (lower !== null && count > 0 && keys[0] <= lower) return false;
				if (upper !== null && count > 0 && keys[count - 1] >= upper) return false;
				return keys.every(isValidIndex);
			})
		);
	});

	it('keeps keys short when spreading many keys into a gap', () => {
		const keys = keysBetween('a0', 'a1', 1000);
		expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(5);
	});
});

describe('rebalancedKeys', () => {
	it('produces short ascending keys for a whole sibling list', () => {
		const keys = rebalancedKeys(10_000);
		expect(isStrictlyAscending(keys)).toBe(true);
		expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4);
	});
});

describe('compareSiblings', () => {
	it('orders by index then id', () => {
		expect(compareSiblings({ index: 'a0', id: 'z' }, { index: 'a1', id: 'a' })).toBeLessThan(0);
		expect(compareSiblings({ index: 'a0', id: 'a' }, { index: 'a0', id: 'b' })).toBeLessThan(0);
		expect(compareSiblings({ index: 'a0', id: 'a' }, { index: 'a0', id: 'a' })).toBe(0);
	});
});
