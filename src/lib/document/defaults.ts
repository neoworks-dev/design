// Default values for every node type. Used by tools that create nodes, by importers and by test
// fixtures, so a freshly created node always passes the schema.

import { generateNodeId } from './ids';
import type {
	AutoLayoutProps,
	BaseProps,
	BlendProps,
	ConstraintProps,
	CornerProps,
	FrameLikeProps,
	GeometryProps,
	LayoutProps,
	Matrix2x3,
	Node,
	NodeOfType,
	NodeType,
	PageNode,
	ShapeProps,
	TextStyle
} from './types';

function identityMatrix(): Matrix2x3 {
	return [
		[1, 0, 0],
		[0, 1, 0]
	];
}

export function defaultTextStyle(): TextStyle {
	return {
		fontName: { family: 'Inter', style: 'Regular' },
		fontWeight: 400,
		fontSize: 16,
		letterSpacing: { value: 0, unit: 'PERCENT' },
		lineHeight: { unit: 'AUTO' },
		textCase: 'ORIGINAL',
		textDecoration: 'NONE',
		openTypeFeatures: {},
		fontVariations: {},
		fills: [
			{
				type: 'SOLID',
				visible: true,
				opacity: 1,
				blendMode: 'NORMAL',
				color: { r: 0, g: 0, b: 0 }
			}
		]
	};
}

function baseProps(id: string, name: string): BaseProps {
	return {
		id,
		name,
		parentId: null,
		index: 'a0',
		pluginData: {},
		visible: true,
		locked: false,
		exportSettings: []
	};
}

function layoutProps(): LayoutProps {
	return {
		transform: identityMatrix(),
		width: 100,
		height: 100,
		minWidth: null,
		maxWidth: null,
		minHeight: null,
		maxHeight: null,
		constrainProportions: false,
		layoutSizingHorizontal: 'FIXED',
		layoutSizingVertical: 'FIXED',
		layoutPositioning: 'AUTO'
	};
}

function blendProps(): BlendProps {
	return { opacity: 1, blendMode: 'PASS_THROUGH', isMask: false, maskType: 'ALPHA', effects: [] };
}

function geometryProps(): GeometryProps {
	return { fills: [], strokes: [] };
}

function cornerProps(): CornerProps {
	return { cornerRadius: 0, cornerSmoothing: 0 };
}

function constraintProps(): ConstraintProps {
	return { constraints: { horizontal: 'MIN', vertical: 'MIN' } };
}

function autoLayoutProps(): AutoLayoutProps {
	return {
		layoutMode: 'NONE',
		layoutWrap: 'NO_WRAP',
		primaryAxisSizingMode: 'AUTO',
		counterAxisSizingMode: 'AUTO',
		primaryAxisAlignItems: 'MIN',
		counterAxisAlignItems: 'MIN',
		counterAxisAlignContent: 'AUTO',
		itemSpacing: 0,
		counterAxisSpacing: null,
		paddingTop: 0,
		paddingRight: 0,
		paddingBottom: 0,
		paddingLeft: 0,
		itemReverseZIndex: false,
		strokesIncludedInLayout: false,
		clipsContent: true,
		gridRows: [],
		gridColumns: [],
		gridRowGap: 0,
		gridColumnGap: 0,
		layoutGrids: []
	};
}

function shapeProps(id: string, name: string): ShapeProps {
	return {
		...baseProps(id, name),
		...layoutProps(),
		...blendProps(),
		...constraintProps(),
		reactions: []
	};
}

function frameLikeProps(id: string, name: string): FrameLikeProps {
	return {
		...shapeProps(id, name),
		...geometryProps(),
		...cornerProps(),
		...autoLayoutProps(),
		blendMode: 'PASS_THROUGH',
		guides: [],
		overflowDirection: 'NONE',
		numberOfFixedChildren: 0
	};
}

function pageDefaults(id: string): PageNode {
	return {
		id,
		type: 'PAGE',
		name: 'Page',
		parentId: null,
		index: 'a0',
		pluginData: {},
		backgrounds: [
			{
				type: 'SOLID',
				visible: true,
				opacity: 1,
				blendMode: 'NORMAL',
				color: { r: 0.96, g: 0.96, b: 0.96 }
			}
		],
		guides: [],
		flowStartingPoints: []
	};
}

function nodeDefaults(type: NodeType, id: string): Node {
	const name = type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
	switch (type) {
		case 'PAGE':
			return pageDefaults(id);
		case 'FRAME':
			return { ...frameLikeProps(id, name), type };
		case 'GROUP':
			return { ...shapeProps(id, name), type };
		case 'SECTION':
			return {
				...baseProps(id, name),
				...layoutProps(),
				...geometryProps(),
				type,
				sectionContentsHidden: false
			};
		case 'RECTANGLE':
			return { ...shapeProps(id, name), ...geometryProps(), ...cornerProps(), type };
		case 'ELLIPSE':
			return {
				...shapeProps(id, name),
				...geometryProps(),
				type,
				arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 }
			};
		case 'LINE':
			return { ...shapeProps(id, name), ...geometryProps(), type, height: 0 };
		case 'POLYGON':
			return {
				...shapeProps(id, name),
				...geometryProps(),
				...cornerProps(),
				type,
				pointCount: 3
			};
		case 'STAR':
			return {
				...shapeProps(id, name),
				...geometryProps(),
				...cornerProps(),
				type,
				pointCount: 5,
				innerRadius: 0.382
			};
		case 'VECTOR':
			return {
				...shapeProps(id, name),
				...geometryProps(),
				...cornerProps(),
				type,
				network: { vertices: [], segments: [] }
			};
		case 'TEXT':
			return {
				...shapeProps(id, name),
				...geometryProps(),
				type,
				paragraphs: [
					{
						runs: [],
						align: 'LEFT',
						indent: 0,
						spacingAfter: 0,
						list: 'NONE',
						listLevel: 0
					}
				],
				defaultStyle: defaultTextStyle(),
				textAutoResize: 'WIDTH_AND_HEIGHT',
				textTruncation: 'DISABLED',
				maxLines: null,
				textAlignVertical: 'TOP',
				leadingTrim: 'NONE'
			};
		case 'BOOLEAN_OPERATION':
			return {
				...shapeProps(id, name),
				...geometryProps(),
				...cornerProps(),
				type,
				booleanOperation: 'UNION'
			};
		case 'COMPONENT':
			return {
				...frameLikeProps(id, name),
				type,
				key: id,
				description: '',
				componentPropertyDefinitions: {}
			};
		case 'COMPONENT_SET':
			return {
				...frameLikeProps(id, name),
				type,
				key: id,
				componentPropertyDefinitions: {}
			};
		case 'INSTANCE':
			return { ...frameLikeProps(id, name), type, mainComponentId: id, componentProperties: {} };
		case 'SLICE':
			return { ...baseProps(id, name), ...layoutProps(), type };
	}
}

export type NodeOverrides<T extends NodeType> = Partial<Omit<NodeOfType<T>, 'type'>>;

/** A complete, schema-valid node of `type`, with `overrides` applied over the defaults. */
export function createNode<T extends NodeType>(
	type: T,
	overrides: NodeOverrides<T> = {}
): NodeOfType<T> {
	const id = typeof overrides.id === 'string' ? overrides.id : generateNodeId();
	const merged = { ...nodeDefaults(type, id), ...overrides, type };
	return merged as NodeOfType<T>;
}
