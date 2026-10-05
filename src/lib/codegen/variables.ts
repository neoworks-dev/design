// The bound-variable state of a node, as lines for the code view: which property reads which
// variable (data-model decision D6: panels show resolved values and say what they are bound to).

import type { BoundVariables, Node, Paint } from '../document';

function aliasId(alias: BoundVariables[string] | undefined): string | undefined {
	if (alias === undefined || Array.isArray(alias)) return undefined;
	return alias.id;
}

function paintLines(paints: readonly Paint[], role: string): { property: string; id: string }[] {
	const lines: { property: string; id: string }[] = [];
	paints.forEach((paint, index) => {
		const id = aliasId(paint.boundVariables?.color);
		if (id !== undefined) lines.push({ property: `${role} ${index + 1} color`, id });
	});
	return lines;
}

/** `{ property, id }` for every variable binding of the (raw, unresolved) node. */
export function boundVariables(node: Node): { property: string; id: string }[] {
	const lines: { property: string; id: string }[] = [];
	for (const [property, alias] of Object.entries(node.boundVariables ?? {})) {
		const id = aliasId(alias);
		if (id !== undefined) lines.push({ property, id });
	}
	if ('fills' in node) lines.push(...paintLines(node.fills, 'fill'));
	if ('strokes' in node) {
		for (const stroke of node.strokes) lines.push(...paintLines(stroke.paints, 'stroke'));
	}
	return lines;
}

/** One `property: variable name` line per binding; empty when nothing is bound. */
export function boundVariableLines(
	node: Node,
	variableName: (id: string) => string | undefined
): string[] {
	return boundVariables(node).map(({ property, id }) => {
		const name = variableName(id);
		return `${property}: ${name === undefined ? id : name}`;
	});
}
