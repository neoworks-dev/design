// Test fixtures: build a whole document from a nested description.
//
//   const document = buildDocument(
//     page('Page 1', [frame({ name: 'A', width: 200 }, [rectangle({ name: 'R' })])])
//   );
//
// Ids are sequential (`n1`, `n2`, ...) unless given, children get evenly spread fractional
// indexes in the order written. Every node passes the schema.

import { createNode, type NodeOverrides } from './defaults';
import { rebalancedKeys } from './fractionalIndex';
import { sequentialIdGenerator, type IdGenerator } from './ids';
import {
	SCHEMA_VERSION,
	type DesignDocument,
	type Node,
	type NodeId,
	type NodeType
} from './types';

export interface NodeSpec {
	type: NodeType;
	props: Record<string, unknown>;
	children: NodeSpec[];
}

export function node<T extends NodeType>(
	type: T,
	props: NodeOverrides<T> = {},
	children: NodeSpec[] = []
): NodeSpec {
	return { type, props, children };
}

export function page(
	name: string,
	children: NodeSpec[] = [],
	props: NodeOverrides<'PAGE'> = {}
): NodeSpec {
	return node('PAGE', { ...props, name }, children);
}
export function frame(props: NodeOverrides<'FRAME'> = {}, children: NodeSpec[] = []): NodeSpec {
	return node('FRAME', props, children);
}
export function group(props: NodeOverrides<'GROUP'> = {}, children: NodeSpec[] = []): NodeSpec {
	return node('GROUP', props, children);
}
export function rectangle(props: NodeOverrides<'RECTANGLE'> = {}): NodeSpec {
	return node('RECTANGLE', props);
}
export function text(props: NodeOverrides<'TEXT'> = {}): NodeSpec {
	return node('TEXT', props);
}

export function emptyDocument(): DesignDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: 'fixture-document',
		name: 'Fixture',
		nodes: {},
		styles: {},
		variableCollections: {},
		variables: {},
		assets: {},
		fonts: []
	};
}

export interface BuildOptions {
	idGenerator?: IdGenerator;
}

export function buildDocument(pages: NodeSpec[], options: BuildOptions = {}): DesignDocument {
	const generate =
		options.idGenerator === undefined ? sequentialIdGenerator('n') : options.idGenerator;
	const document = emptyDocument();
	addSiblings(document, pages, null, generate);
	return document;
}

function addSiblings(
	document: DesignDocument,
	specs: NodeSpec[],
	parentId: NodeId | null,
	generate: IdGenerator
): void {
	const indexes = rebalancedKeys(specs.length);
	specs.forEach((spec, position) => {
		const explicitId = spec.props.id;
		const id = typeof explicitId === 'string' ? explicitId : generate();
		const created: Node = createNode(spec.type, {
			...spec.props,
			id,
			parentId,
			index: indexes[position]
		});
		document.nodes[id] = created;
		addSiblings(document, spec.children, id, generate);
	});
}
