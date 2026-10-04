import { createNode, type Paint, type Stroke } from '../../lib/document';
import type { CreationToolSpec } from '../../lib/editing/creationTool.svelte';
import type { PositionedNode } from '../../lib/editing/selectionOps';
import type { LocalPlacement } from '../../lib/tools/creation';

function solid(level: number): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r: level, g: level, b: level }
	};
}

/** Light grey fill, the default of every closed shape. */
const SHAPE_FILLS: Paint[] = [solid(0.85)];

function lineStroke(cap: Stroke['cap']): Stroke {
	return {
		paints: [solid(0)],
		weight: 1,
		align: 'CENTER',
		cap,
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

export const POLYGON_SIDES = 3;
export const STAR_POINTS = 5;

export interface ShapeToolDefinition {
	id: string;
	title: string;
	shortcut?: string;
	/** On the toolbar itself; the others are reached by shortcut, command or the shapes menu. */
	toolbar: boolean;
	order: number;
	spec: CreationToolSpec;
}

function boxSpec(
	nodeType: PositionedNode['type'],
	label: string,
	build: (placement: LocalPlacement, name: string) => PositionedNode
): CreationToolSpec {
	return { nodeType, label, geometry: 'box', build };
}

function lineSpec(label: string, cap: Stroke['cap']): CreationToolSpec {
	return {
		nodeType: 'LINE',
		label,
		geometry: 'line',
		build: (placement, name) =>
			createNode('LINE', { name, ...placement, fills: [], strokes: [lineStroke(cap)] })
	};
}

export const SHAPE_TOOLS: ShapeToolDefinition[] = [
	{
		id: 'rectangle',
		title: 'Rectangle',
		shortcut: 'R',
		toolbar: true,
		order: 11,
		spec: boxSpec('RECTANGLE', 'Rectangle', (placement, name) =>
			createNode('RECTANGLE', { name, ...placement, fills: SHAPE_FILLS })
		)
	},
	{
		id: 'ellipse',
		title: 'Ellipse',
		shortcut: 'O',
		toolbar: true,
		order: 11.1,
		spec: boxSpec('ELLIPSE', 'Ellipse', (placement, name) =>
			createNode('ELLIPSE', { name, ...placement, fills: SHAPE_FILLS })
		)
	},
	{
		id: 'line',
		title: 'Line',
		shortcut: 'L',
		toolbar: true,
		order: 11.2,
		spec: lineSpec('Line', 'NONE')
	},
	{
		id: 'arrow',
		title: 'Arrow',
		shortcut: 'Shift+L',
		toolbar: false,
		order: 11.3,
		spec: lineSpec('Arrow', 'ARROW_LINES')
	},
	{
		id: 'polygon',
		title: 'Polygon',
		toolbar: false,
		order: 11.4,
		spec: boxSpec('POLYGON', 'Polygon', (placement, name) =>
			createNode('POLYGON', { name, ...placement, fills: SHAPE_FILLS, pointCount: POLYGON_SIDES })
		)
	},
	{
		id: 'star',
		title: 'Star',
		toolbar: false,
		order: 11.5,
		spec: boxSpec('STAR', 'Star', (placement, name) =>
			createNode('STAR', { name, ...placement, fills: SHAPE_FILLS, pointCount: STAR_POINTS })
		)
	}
];
