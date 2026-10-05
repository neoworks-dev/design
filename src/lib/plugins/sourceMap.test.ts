import { describe, expect, it } from 'vitest';
import { mapStackTrace, originalPositionFor, parseSourceMap } from './sourceMap';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value: number): string {
	let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
	let text = '';
	do {
		let digit = remaining & 31;
		remaining >>>= 5;
		if (remaining > 0) digit |= 32;
		text += BASE64[digit];
	} while (remaining > 0);
	return text;
}

function segment(...fields: number[]): string {
	return fields.map(vlq).join('');
}

/** Generated line 1 maps column 0 to src/a.ts 1:0 and column 10 to 4:2; line 2 column 4 to src/b.ts 7:0. */
const MAP = JSON.stringify({
	version: 3,
	sources: ['src/a.ts', 'src/b.ts'],
	names: [],
	mappings: `${segment(0, 0, 0, 0)},${segment(10, 0, 3, 2)};${segment(4, 1, 3, -2)}`
});

describe('source maps', () => {
	it('finds the original position of a generated one', () => {
		const map = parseSourceMap(MAP);
		if (map === null) throw new Error('expected a map');
		expect(originalPositionFor(map, 1, 1)).toEqual({ source: 'src/a.ts', line: 1, column: 1 });
		expect(originalPositionFor(map, 1, 14)).toEqual({ source: 'src/a.ts', line: 4, column: 3 });
		expect(originalPositionFor(map, 2, 6)).toEqual({ source: 'src/b.ts', line: 7, column: 1 });
		expect(originalPositionFor(map, 9, 1)).toBeNull();
	});

	it('rewrites the frames of the bundle in a stack trace and leaves others alone', () => {
		const map = parseSourceMap(MAP);
		if (map === null) throw new Error('expected a map');
		const stack = [
			'Error: boom',
			'    at run (blob:app://design/1234:1:14)',
			'    at main.js:2:6',
			'    at other (app://design/_app/chunk.js:5:5)'
		].join('\n');
		expect(mapStackTrace(stack, map, 'main.js').split('\n')).toEqual([
			'Error: boom',
			'    at run (src/a.ts:4:3)',
			'    at src/b.ts:7:1',
			'    at other (app://design/_app/chunk.js:5:5)'
		]);
	});

	it('refuses what is not a source map', () => {
		expect(parseSourceMap('{oops')).toBeNull();
		expect(parseSourceMap('{"version":3}')).toBeNull();
	});
});
