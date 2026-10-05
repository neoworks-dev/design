// The built-in languages: CSS, SVG and JSON.

import type { Node } from '../document';
import { cssDeclarations } from '../editing/css';
import { exportSvg } from '../editing/svg';
import type { CodegenBlock, CodegenInput, CodegenProvider } from './types';

/** Rewrites every `<n>px` in `code` as rem; `0px` stays as the bare `0` CSS already uses. */
export function pixelsToRem(code: string, rootFontSize: number): string {
	return code.replace(/(-?\d+(?:\.\d+)?)px/g, (_match, value: string) => {
		const rem = Math.round((Number(value) / rootFontSize) * 1000) / 1000;
		return `${rem}rem`;
	});
}

function cssBlocks(input: CodegenInput): CodegenBlock[] {
	let code = cssDeclarations(input.node).join('\n');
	if (input.options.unit === 'rem') code = pixelsToRem(code, input.options.rootFontSize);
	return [{ title: input.node.name, code }];
}

export const cssProvider: CodegenProvider = {
	id: 'css',
	label: 'CSS',
	order: 0,
	usesUnit: true,
	generate: cssBlocks
};

export const svgProvider: CodegenProvider = {
	id: 'svg',
	label: 'SVG',
	order: 1,
	generate(input) {
		const code = exportSvg(input.reader, [input.nodeId]);
		if (code === null) return [];
		return [{ title: input.node.name, code }];
	}
};

const STRUCTURAL_KEYS = ['parentId', 'index', 'pluginData', 'componentRef', 'touched'];

/** The node as plain JSON without the keys that only describe where it sits in the tree. */
export function nodeJson(node: Node): string {
	const copy: Record<string, unknown> = { ...node };
	for (const key of STRUCTURAL_KEYS) delete copy[key];
	return JSON.stringify(copy, null, 2);
}

export const jsonProvider: CodegenProvider = {
	id: 'json',
	label: 'JSON',
	order: 2,
	generate(input) {
		return [{ title: input.node.name, code: nodeJson(input.node) }];
	}
};

export const BUILTIN_PROVIDERS: readonly CodegenProvider[] = [
	cssProvider,
	svgProvider,
	jsonProvider
];
