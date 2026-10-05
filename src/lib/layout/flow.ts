// What the Flow buttons, the alignment grid and the padding fields write. Pure helpers: they
// turn a choice in the panel into property sets or change plans.

import { planSetProps, type Change, type DocumentReader, type Node } from '../document';
import { isStackContainer } from './build';
import { planEnableAutoLayout, planRemoveAutoLayout } from './toggle';

export type Flow = 'NONE' | 'VERTICAL' | 'HORIZONTAL' | 'WRAP';

/** The Flow button a node shows as pressed; undefined for nodes that cannot have auto layout. */
export function flowOf(node: Node): Flow | undefined {
	if (!('layoutMode' in node)) return undefined;
	if (node.layoutMode === 'HORIZONTAL' && node.layoutWrap === 'WRAP') return 'WRAP';
	if (node.layoutMode === 'HORIZONTAL') return 'HORIZONTAL';
	if (node.layoutMode === 'VERTICAL') return 'VERTICAL';
	return 'NONE';
}

/** Changes that put `node` into `flow`; turning auto layout on infers spacing and padding. */
export function planSetFlow(reader: DocumentReader, node: Node, flow: Flow): Change[] {
	if (!('layoutMode' in node)) return [];
	if (flow === 'NONE') return planRemoveAutoLayout(reader, [node.id]);
	if (!isStackContainer(node)) {
		return planEnableAutoLayout(reader, node, {
			direction: flow === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL',
			wrap: flow === 'WRAP'
		});
	}
	if (flow === 'VERTICAL') {
		return planSetProps(reader, node.id, { layoutMode: 'VERTICAL', layoutWrap: 'NO_WRAP' });
	}
	if (flow === 'HORIZONTAL') {
		return planSetProps(reader, node.id, { layoutMode: 'HORIZONTAL', layoutWrap: 'NO_WRAP' });
	}
	// Lines break at the frame's width, so a wrapping frame cannot also hug its width.
	return planSetProps(reader, node.id, {
		layoutMode: 'HORIZONTAL',
		layoutWrap: 'WRAP',
		layoutSizingHorizontal:
			node.layoutSizingHorizontal === 'HUG' ? 'FIXED' : node.layoutSizingHorizontal
	});
}

// ---------- the 3 x 3 alignment grid ----------

export type GridIndex = 0 | 1 | 2;
export interface GridCell {
	column: GridIndex;
	row: GridIndex;
}

type PrimaryAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
type CounterAlign = 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';

const ALIGN_VALUES = ['MIN', 'CENTER', 'MAX'] as const;

function indexOfAlign(value: string): GridIndex | null {
	if (value === 'MIN') return 0;
	if (value === 'CENTER') return 1;
	if (value === 'MAX') return 2;
	return null;
}

/**
 * The cell the alignment grid highlights: columns are the horizontal axis, rows the vertical.
 * A part that is not a plain MIN / CENTER / MAX (space between, baseline) leaves its index null.
 */
export function cellOf(
	mode: 'HORIZONTAL' | 'VERTICAL',
	primary: PrimaryAlign,
	counter: CounterAlign
): { column: GridIndex | null; row: GridIndex | null } {
	if (mode === 'HORIZONTAL') return { column: indexOfAlign(primary), row: indexOfAlign(counter) };
	return { column: indexOfAlign(counter), row: indexOfAlign(primary) };
}

/** Alignment props for a click on `cell`; space between on the primary axis is kept. */
export function alignmentProps(
	mode: 'HORIZONTAL' | 'VERTICAL',
	primary: PrimaryAlign,
	cell: GridCell
): Record<string, unknown> {
	const primaryIndex = mode === 'HORIZONTAL' ? cell.column : cell.row;
	const counterIndex = mode === 'HORIZONTAL' ? cell.row : cell.column;
	const props: Record<string, unknown> = { counterAxisAlignItems: ALIGN_VALUES[counterIndex] };
	if (primary !== 'SPACE_BETWEEN') props.primaryAxisAlignItems = ALIGN_VALUES[primaryIndex];
	return props;
}

// ---------- padding ----------

export type PaddingSide = 'Top' | 'Right' | 'Bottom' | 'Left';

export function paddingKey(side: PaddingSide): string {
	return `padding${side}`;
}

export const HORIZONTAL_PADDING: PaddingSide[] = ['Left', 'Right'];
export const VERTICAL_PADDING: PaddingSide[] = ['Top', 'Bottom'];
