// The properties to write when the user picks Fixed, Hug or Fill on one axis. Text carries its
// hug state in `textAutoResize` as well, so the two have to move together; every other node only
// has `layoutSizing*`.

import type { Node } from '../document/types';
import type { Sizing } from './types';

export type SizingAxis = 'horizontal' | 'vertical';

function sizingKey(axis: SizingAxis): 'layoutSizingHorizontal' | 'layoutSizingVertical' {
	if (axis === 'horizontal') return 'layoutSizingHorizontal';
	return 'layoutSizingVertical';
}

export function currentSizing(node: Node, axis: SizingAxis): Sizing {
	if (!('layoutSizingHorizontal' in node)) return 'FIXED';
	return node[sizingKey(axis)];
}

export function sizingProps(node: Node, axis: SizingAxis, sizing: Sizing): Record<string, unknown> {
	if (!('layoutSizingHorizontal' in node)) return {};
	if (node.type !== 'TEXT') return { [sizingKey(axis)]: sizing };
	if (axis === 'horizontal') return horizontalTextProps(node.textAutoResize, sizing);
	return verticalTextProps(node, sizing);
}

function horizontalTextProps(autoResize: string, sizing: Sizing): Record<string, unknown> {
	if (sizing === 'HUG') {
		return {
			layoutSizingHorizontal: 'HUG',
			layoutSizingVertical: 'HUG',
			textAutoResize: 'WIDTH_AND_HEIGHT'
		};
	}
	if (autoResize === 'WIDTH_AND_HEIGHT') {
		return { layoutSizingHorizontal: sizing, textAutoResize: 'HEIGHT' };
	}
	return { layoutSizingHorizontal: sizing };
}

function verticalTextProps(
	node: Extract<Node, { type: 'TEXT' }>,
	sizing: Sizing
): Record<string, unknown> {
	if (sizing === 'HUG') {
		if (node.textAutoResize === 'NONE') {
			return { layoutSizingVertical: 'HUG', textAutoResize: 'HEIGHT' };
		}
		return { layoutSizingVertical: 'HUG' };
	}
	const props: Record<string, unknown> = { layoutSizingVertical: sizing, textAutoResize: 'NONE' };
	if (node.layoutSizingHorizontal === 'HUG') props.layoutSizingHorizontal = 'FIXED';
	return props;
}
