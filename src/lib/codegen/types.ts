// Code generation for the Inspect panel (#95): what a provider receives and returns. A provider
// turns one node into named code blocks in one language; plugins register more languages later.

import type { DocumentReader, Node, NodeId } from '../document';

export type CodegenUnit = 'px' | 'rem';

export interface CodegenOptions {
	unit: CodegenUnit;
	/** Pixels per rem when `unit` is `rem`. */
	rootFontSize: number;
}

export const DEFAULT_CODEGEN_OPTIONS: CodegenOptions = { unit: 'px', rootFontSize: 16 };

export interface CodegenInput {
	nodeId: NodeId;
	/** The node with bound variables resolved to their values. */
	node: Node;
	/** For readers that need the whole tree (SVG export of children). */
	reader: DocumentReader;
	options: CodegenOptions;
}

export interface CodegenBlock {
	title: string;
	code: string;
}

export interface CodegenProvider {
	id: string;
	label: string;
	/** Ascending in the language picker. */
	order?: number;
	/** Whether the unit setting changes this provider's output. */
	usesUnit?: boolean;
	generate(input: CodegenInput): CodegenBlock[];
}
