// Fractional indexing: string keys that sort lexicographically, with a key always available
// between any two keys. Base-62 digits (0-9, A-Z, a-z), which are in ASCII order, so plain `<` on
// strings is the sort order.
//
// A key is an integer part followed by a fractional part. The first character of the integer part
// encodes its length: 'a' is 2 characters, 'b' is 3, ... 'z' is 27; 'Z' is 2, 'Y' is 3, ... 'A' is
// 27. 'a0' is the first key. Appending at the end increments the integer part; only when the
// fractional part has to grow does a key get longer. Keys never end in '0' in the fractional part,
// which keeps every key reachable from both sides.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const FIRST_DIGIT = DIGITS.charAt(0);
const LAST_DIGIT = DIGITS.charAt(BASE - 1);
const SMALLEST_INTEGER = `A${FIRST_DIGIT.repeat(26)}`;

function digitValue(character: string): number {
	const value = DIGITS.indexOf(character);
	if (value < 0) throw new Error(`invalid fractional index digit: ${character}`);
	return value;
}

function integerLength(head: string): number {
	if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
	if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
	throw new Error(`invalid fractional index head: ${head}`);
}

function integerPart(key: string): string {
	const length = integerLength(key.charAt(0));
	if (length > key.length) throw new Error(`invalid fractional index: ${key}`);
	return key.slice(0, length);
}

export function isValidIndex(key: string): boolean {
	try {
		validateKey(key);
		return true;
	} catch {
		return false;
	}
}

function validateKey(key: string): void {
	if (key === SMALLEST_INTEGER) throw new Error(`invalid fractional index: ${key}`);
	const integer = integerPart(key);
	const fraction = key.slice(integer.length);
	if (fraction.endsWith(FIRST_DIGIT)) throw new Error(`invalid fractional index: ${key}`);
	for (const character of key) digitValue(character);
}

/** A string strictly between `lower` and `upper` (`null` upper means unbounded), digits only. */
function midpoint(lower: string, upper: string | null): string {
	if (upper !== null && lower >= upper) throw new Error(`${lower} >= ${upper}`);
	if (lower.endsWith(FIRST_DIGIT) || (upper !== null && upper.endsWith(FIRST_DIGIT))) {
		throw new Error('trailing zero');
	}
	if (upper !== null) {
		let commonLength = 0;
		while ((lower.charAt(commonLength) || FIRST_DIGIT) === upper.charAt(commonLength)) {
			commonLength += 1;
		}
		if (commonLength > 0) {
			return (
				upper.slice(0, commonLength) +
				midpoint(lower.slice(commonLength), upper.slice(commonLength))
			);
		}
	}
	const lowerDigit = lower === '' ? 0 : digitValue(lower.charAt(0));
	const upperDigit = upper === null ? BASE : digitValue(upper.charAt(0));
	if (upperDigit - lowerDigit > 1) {
		return DIGITS.charAt(Math.round(0.5 * (lowerDigit + upperDigit)));
	}
	if (upper !== null && upper.length > 1) return upper.slice(0, 1);
	return `${DIGITS.charAt(lowerDigit)}${midpoint(lower.slice(1), null)}`;
}

function incrementInteger(integer: string): string | null {
	const head = integer.charAt(0);
	const digits = integer.slice(1).split('');
	let carry = true;
	for (let position = digits.length - 1; carry && position >= 0; position -= 1) {
		const next = digitValue(digits[position]) + 1;
		if (next === BASE) {
			digits[position] = FIRST_DIGIT;
			continue;
		}
		digits[position] = DIGITS.charAt(next);
		carry = false;
	}
	if (!carry) return head + digits.join('');
	if (head === 'Z') return `a${FIRST_DIGIT}`;
	if (head === 'z') return null;
	const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
	if (nextHead > 'a') {
		digits.push(FIRST_DIGIT);
	} else {
		digits.pop();
	}
	return nextHead + digits.join('');
}

function decrementInteger(integer: string): string | null {
	const head = integer.charAt(0);
	const digits = integer.slice(1).split('');
	let borrow = true;
	for (let position = digits.length - 1; borrow && position >= 0; position -= 1) {
		const next = digitValue(digits[position]) - 1;
		if (next === -1) {
			digits[position] = LAST_DIGIT;
			continue;
		}
		digits[position] = DIGITS.charAt(next);
		borrow = false;
	}
	if (!borrow) return head + digits.join('');
	if (head === 'a') return `Z${LAST_DIGIT}`;
	if (head === 'A') return null;
	const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
	if (nextHead < 'Z') {
		digits.push(LAST_DIGIT);
	} else {
		digits.pop();
	}
	return nextHead + digits.join('');
}

/**
 * A key strictly between `lower` and `upper`. `null` means no bound on that side:
 * `keyBetween(null, null)` is the first key, `keyBetween(last, null)` appends,
 * `keyBetween(null, first)` prepends.
 */
export function keyBetween(lower: string | null, upper: string | null): string {
	if (lower !== null) validateKey(lower);
	if (upper !== null) validateKey(upper);
	if (lower !== null && upper !== null && lower >= upper) {
		throw new Error(`${lower} >= ${upper}`);
	}
	if (lower === null && upper === null) return `a${FIRST_DIGIT}`;
	if (lower === null) return keyBefore(upper as string);
	if (upper === null) return keyAfter(lower);
	return keyInside(lower, upper);
}

function keyBefore(upper: string): string {
	const integer = integerPart(upper);
	const fraction = upper.slice(integer.length);
	if (integer === SMALLEST_INTEGER) return integer + midpoint('', fraction);
	if (integer < upper) return integer;
	const decremented = decrementInteger(integer);
	if (decremented === null) throw new Error('cannot decrement any more');
	return decremented;
}

function keyAfter(lower: string): string {
	const integer = integerPart(lower);
	const fraction = lower.slice(integer.length);
	const incremented = incrementInteger(integer);
	if (incremented === null) return `${integer}${midpoint(fraction, null)}`;
	return incremented;
}

function keyInside(lower: string, upper: string): string {
	const lowerInteger = integerPart(lower);
	const lowerFraction = lower.slice(lowerInteger.length);
	const upperInteger = integerPart(upper);
	const upperFraction = upper.slice(upperInteger.length);
	if (lowerInteger === upperInteger) {
		return lowerInteger + midpoint(lowerFraction, upperFraction);
	}
	const incremented = incrementInteger(lowerInteger);
	if (incremented === null) throw new Error('cannot increment any more');
	if (incremented < upper) return incremented;
	return lowerInteger + midpoint(lowerFraction, null);
}

/** `count` ascending keys strictly between `lower` and `upper`, spread so lengths stay short. */
export function keysBetween(lower: string | null, upper: string | null, count: number): string[] {
	if (count < 0 || !Number.isInteger(count)) throw new Error(`invalid count: ${count}`);
	if (count === 0) return [];
	if (count === 1) return [keyBetween(lower, upper)];
	if (upper === null) return keysAfter(lower, count);
	if (lower === null) return keysBefore(upper, count);
	const middleCount = Math.floor(count / 2);
	const middle = keyBetween(lower, upper);
	return [
		...keysBetween(lower, middle, middleCount),
		middle,
		...keysBetween(middle, upper, count - middleCount - 1)
	];
}

function keysAfter(lower: string | null, count: number): string[] {
	const keys: string[] = [];
	let current = keyBetween(lower, null);
	keys.push(current);
	for (let produced = 1; produced < count; produced += 1) {
		current = keyBetween(current, null);
		keys.push(current);
	}
	return keys;
}

function keysBefore(upper: string, count: number): string[] {
	const keys: string[] = [];
	let current = keyBetween(null, upper);
	keys.push(current);
	for (let produced = 1; produced < count; produced += 1) {
		current = keyBetween(null, current);
		keys.push(current);
	}
	return keys.reverse();
}

/**
 * Fresh evenly spread keys for `count` siblings. Use to rebalance a parent whose keys have grown
 * long after many insertions at the same spot.
 */
export function rebalancedKeys(count: number): string[] {
	return keysBetween(null, null, count);
}

/** Order of two siblings: by key, then by id so equal keys still sort deterministically. */
export function compareSiblings(
	left: { index: string; id: string },
	right: { index: string; id: string }
): number {
	if (left.index < right.index) return -1;
	if (left.index > right.index) return 1;
	if (left.id < right.id) return -1;
	if (left.id > right.id) return 1;
	return 0;
}
