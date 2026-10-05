import { describe, expect, it } from 'vitest';
import { buildDocument, page, rectangle } from '../document/fixtures';
import type { Node } from '../document';
import { boundVariableId, sharedValue } from './values';

function nodesOf(...widths: number[]): Node[] {
	const specs = widths.map((width, position) => rectangle({ id: `r${position}`, width }));
	const document = buildDocument([page('Page', specs)]);
	return Object.values(document.nodes).filter((node) => node.type === 'RECTANGLE');
}

describe('sharedValue', () => {
	it('is the value when every item agrees', () => {
		const nodes = nodesOf(10, 10);
		expect(sharedValue(nodes, (node) => Reflect.get(node, 'width'))).toEqual({
			value: 10,
			mixed: false
		});
	});

	it('is mixed when items differ and empty without items', () => {
		const nodes = nodesOf(10, 20);
		expect(sharedValue(nodes, (node) => Reflect.get(node, 'width'))).toEqual({
			value: null,
			mixed: true
		});
		expect(sharedValue([], () => 1)).toEqual({ value: null, mixed: false });
	});
});

describe('boundVariableId', () => {
	it('returns the id only when every node binds the same variable', () => {
		const [first, second] = nodesOf(10, 10);
		const alias = { type: 'VARIABLE_ALIAS' as const, id: 'v1' };
		const bound = { ...first, boundVariables: { width: alias } };
		expect(boundVariableId([bound, { ...second, boundVariables: { width: alias } }], 'width')).toBe(
			'v1'
		);
		expect(boundVariableId([bound, second], 'width')).toBeNull();
	});
});
