// Source maps for the plugin console: a plugin is bundled to one file (`main.js`) and its errors
// name lines of that bundle. If the plugin ships `main.js.map`, the console shows the original
// file, line and column instead. Pure: a small version 3 reader (VLQ `mappings`), no dependencies.

export interface SourceMap {
	sources: string[];
	/** Per generated line (0-based), segments sorted by generated column. */
	lines: Segment[][];
}

interface Segment {
	column: number;
	source: number;
	line: number;
	originalColumn: number;
}

export interface OriginalPosition {
	source: string;
	line: number;
	column: number;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeSegment(text: string): number[] {
	const values: number[] = [];
	let value = 0;
	let shift = 0;
	for (const character of text) {
		const digit = BASE64.indexOf(character);
		if (digit < 0) return [];
		value += (digit & 31) << shift;
		if ((digit & 32) !== 0) {
			shift += 5;
			continue;
		}
		const negative = (value & 1) === 1;
		const magnitude = value >> 1;
		values.push(negative ? -magnitude : magnitude);
		value = 0;
		shift = 0;
	}
	return values;
}

/** The map in `json`, or `null` when it is not a usable version 3 source map. */
export function parseSourceMap(json: string): SourceMap | null {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof raw !== 'object' || raw === null) return null;
	const sources: unknown = Reflect.get(raw, 'sources');
	const mappings: unknown = Reflect.get(raw, 'mappings');
	if (!Array.isArray(sources) || typeof mappings !== 'string') return null;
	const root: unknown = Reflect.get(raw, 'sourceRoot');
	let prefix = '';
	if (typeof root === 'string' && root !== '') prefix = `${root.replace(/\/$/, '')}/`;
	let source = 0;
	let line = 0;
	let originalColumn = 0;
	const lines: Segment[][] = [];
	for (const generatedLine of mappings.split(';')) {
		let column = 0;
		const segments: Segment[] = [];
		for (const text of generatedLine.split(',')) {
			if (text === '') continue;
			const fields = decodeSegment(text);
			column += fields[0];
			if (fields.length >= 4) {
				source += fields[1];
				line += fields[2];
				originalColumn += fields[3];
				segments.push({ column, source, line, originalColumn });
			}
		}
		lines.push(segments);
	}
	return { sources: sources.map((name) => `${prefix}${String(name)}`), lines };
}

/** The original position of a generated position (1-based line and column, as in stack traces). */
export function originalPositionFor(
	map: SourceMap,
	line: number,
	column: number
): OriginalPosition | null {
	const segments = map.lines[line - 1];
	if (segments === undefined || segments.length === 0) return null;
	let found: Segment | null = null;
	for (const segment of segments) {
		if (segment.column > column - 1) break;
		found = segment;
	}
	if (found === null) return null;
	return {
		source: map.sources[found.source],
		line: found.line + 1,
		column: found.originalColumn + 1
	};
}

const FRAME = /^(\s+at (?:.*? \()?)(\S+?):(\d+):(\d+)(\)?)$/;

/**
 * `stack` with the frames of the plugin's bundle replaced by original positions. A frame belongs to
 * the bundle when its file is the plugin's `main` file or a blob (the worker loads the module as one).
 */
export function mapStackTrace(stack: string, map: SourceMap, mainFile: string): string {
	return stack
		.split('\n')
		.map((text) => {
			const match = FRAME.exec(text);
			if (match === null) return text;
			const [, before, file, lineText, columnText, after] = match;
			if (!file.startsWith('blob:') && !file.endsWith(mainFile)) return text;
			const original = originalPositionFor(map, Number(lineText), Number(columnText));
			if (original === null) return text;
			return `${before}${original.source}:${original.line}:${original.column}${after}`;
		})
		.join('\n');
}
