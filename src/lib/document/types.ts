// Persisted document model. Decisions: docs/design/data-model.md (sections 1 to 5, provisional 7).
// Pure types: no Svelte, no kernel, no Electron. Derived data lives in derived.ts and is never
// part of any type in this file.

// ---------- primitives ----------

export type NodeId = string;

export interface RGB {
	r: number;
	g: number;
	b: number;
}
export interface RGBA extends RGB {
	a: number;
}
/** [[a, c, e], [b, d, f]]: maps (x, y) to (a*x + c*y + e, b*x + d*y + f). */
export type Matrix2x3 = [[number, number, number], [number, number, number]];
export interface Vec2 {
	x: number;
	y: number;
}
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

// ---------- variables (section 4) ----------

export type VariableType = 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';
export interface VariableAlias {
	type: 'VARIABLE_ALIAS';
	id: string;
}
export type VariableValue = boolean | number | string | RGBA | VariableAlias;
export type CodeSyntaxPlatform = 'WEB' | 'ANDROID' | 'iOS';
export interface Variable {
	id: string;
	name: string;
	collectionId: string;
	resolvedType: VariableType;
	valuesByMode: Record<string, VariableValue>;
	scopes: string[];
	codeSyntax: Partial<Record<CodeSyntaxPlatform, string>>;
	description: string;
}
export interface VariableMode {
	modeId: string;
	name: string;
}
export interface VariableCollection {
	id: string;
	name: string;
	modes: VariableMode[];
	defaultModeId: string;
	variableIds: string[];
}
/** Property name to the variable bound to it. Raw property value stays as fallback. */
export type BoundVariables = Record<string, VariableAlias | VariableAlias[]>;

// ---------- paints, effects, strokes, grids ----------

export const BLEND_MODES = [
	'PASS_THROUGH',
	'NORMAL',
	'DARKEN',
	'MULTIPLY',
	'LINEAR_BURN',
	'COLOR_BURN',
	'LIGHTEN',
	'SCREEN',
	'LINEAR_DODGE',
	'COLOR_DODGE',
	'OVERLAY',
	'SOFT_LIGHT',
	'HARD_LIGHT',
	'DIFFERENCE',
	'EXCLUSION',
	'HUE',
	'SATURATION',
	'COLOR',
	'LUMINOSITY'
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

interface PaintBase {
	visible: boolean;
	opacity: number;
	blendMode: BlendMode;
	boundVariables?: BoundVariables;
}
export interface SolidPaint extends PaintBase {
	type: 'SOLID';
	color: RGB;
}
export interface ColorStop {
	position: number;
	color: RGBA;
	boundVariables?: BoundVariables;
}
export interface GradientPaint extends PaintBase {
	type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
	gradientTransform: Matrix2x3;
	gradientStops: ColorStop[];
}
export interface ImageFilters {
	exposure?: number;
	contrast?: number;
	saturation?: number;
	temperature?: number;
	tint?: number;
	highlights?: number;
	shadows?: number;
}
export interface ImagePaint extends PaintBase {
	type: 'IMAGE';
	imageHash: string;
	scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
	imageTransform?: Matrix2x3;
	scalingFactor?: number;
	rotation?: 0 | 90 | 180 | 270;
	filters?: ImageFilters;
}
export type Paint = SolidPaint | GradientPaint | ImagePaint;

export interface ShadowEffect {
	type: 'DROP_SHADOW' | 'INNER_SHADOW';
	visible: boolean;
	color: RGBA;
	offset: Vec2;
	radius: number;
	spread: number;
	blendMode: BlendMode;
	showShadowBehindNode?: boolean;
	boundVariables?: BoundVariables;
}
export interface BlurEffect {
	type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
	visible: boolean;
	radius: number;
	blurType?: 'NORMAL' | 'PROGRESSIVE';
	startRadius?: number;
	startOffset?: Vec2;
	endOffset?: Vec2;
	boundVariables?: BoundVariables;
}
export type Effect = ShadowEffect | BlurEffect;

export interface StrokeWeights {
	top: number;
	right: number;
	bottom: number;
	left: number;
}
export interface Stroke {
	paints: Paint[];
	weight: number | StrokeWeights;
	align: 'INSIDE' | 'OUTSIDE' | 'CENTER';
	cap: 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL';
	join: 'MITER' | 'BEVEL' | 'ROUND';
	miterLimit: number;
	dashPattern: number[];
}

export interface LayoutGrid {
	pattern: 'GRID' | 'COLUMNS' | 'ROWS';
	visible: boolean;
	color: RGBA;
	sectionSize?: number;
	alignment?: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH';
	gutterSize?: number;
	offset?: number;
	count?: number;
}
export interface Guide {
	axis: 'X' | 'Y';
	offset: number;
}
export interface GridTrack {
	type: 'FLEX' | 'FIXED' | 'HUG';
	value?: number;
}

export interface ExportSetting {
	suffix: string;
	format: 'PNG' | 'JPG' | 'SVG' | 'PDF' | 'WEBP';
	constraint: { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number };
}

// ---------- prototyping ----------

export type Trigger =
	| { type: 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG' }
	| { type: 'AFTER_TIMEOUT'; timeout: number }
	| { type: 'ON_KEY_DOWN'; device: 'KEYBOARD' | 'GAMEPAD'; keyCodes: number[] };
export interface Transition {
	type:
		| 'DISSOLVE'
		| 'SMART_ANIMATE'
		| 'SCROLL_ANIMATE'
		| 'MOVE_IN'
		| 'MOVE_OUT'
		| 'PUSH'
		| 'SLIDE_IN'
		| 'SLIDE_OUT';
	direction?: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
	duration: number;
	easing: { type: string; bezier?: [number, number, number, number] };
	matchLayers?: boolean;
}
export type Action =
	| { type: 'BACK' | 'CLOSE' }
	| { type: 'URL'; url: string; openInNewTab?: boolean }
	| {
			type: 'NODE';
			destinationId: NodeId | null;
			navigation: 'NAVIGATE' | 'SWAP' | 'OVERLAY' | 'SCROLL_TO' | 'CHANGE_TO';
			transition?: Transition;
			preserveScrollPosition?: boolean;
	  }
	| { type: 'SET_VARIABLE'; variableId: string; value: VariableValue };
export interface Reaction {
	trigger: Trigger | null;
	actions: Action[];
}

// ---------- text (section 3, provisional 7) ----------

export interface FontName {
	family: string;
	style: string;
}
export interface TextMeasure {
	value: number;
	unit: 'PIXELS' | 'PERCENT';
}
export type TextLineHeight = TextMeasure | { unit: 'AUTO' };
export interface Hyperlink {
	type: 'URL' | 'NODE';
	value: string;
}
export interface TextStyle {
	fontName: FontName;
	fontWeight: number;
	fontSize: number;
	letterSpacing: TextMeasure;
	lineHeight: TextLineHeight;
	textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED';
	textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
	openTypeFeatures: Record<string, boolean>;
	fontVariations: Record<string, number>;
	fills: Paint[];
	hyperlink?: Hyperlink;
	textStyleId?: string;
	boundVariables?: BoundVariables;
}
/** Delta over the owning node's `defaultStyle`. */
export interface TextRun {
	text: string;
	style: Partial<TextStyle>;
}
export interface Paragraph {
	runs: TextRun[];
	align: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
	indent: number;
	spacingAfter: number;
	list: 'NONE' | 'ORDERED' | 'UNORDERED';
	listLevel: number;
}

// ---------- vectors ----------

export interface VectorVertex {
	x: number;
	y: number;
	strokeCap?: string;
	strokeJoin?: string;
	cornerRadius?: number;
	handleMirroring?: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH';
}
export interface VectorSegment {
	start: number;
	end: number;
	tangentStart?: Vec2;
	tangentEnd?: Vec2;
}
export interface VectorRegion {
	windingRule: 'NONZERO' | 'EVENODD';
	loops: number[][];
	fills?: Paint[];
}
export interface VectorNetwork {
	vertices: VectorVertex[];
	segments: VectorSegment[];
	regions?: VectorRegion[];
}

// ---------- components (section 2) ----------

export type ComponentPropertyType = 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'VARIANT' | 'SLOT';
export interface ComponentPropertyDefinition {
	type: ComponentPropertyType;
	defaultValue: boolean | string;
	variantOptions?: string[];
	preferredValues?: { type: 'COMPONENT' | 'COMPONENT_SET'; key: string }[];
}
export type ComponentPropertyTarget = 'visible' | 'characters' | 'mainComponent';
export interface ComponentPropertyValue {
	type: ComponentPropertyType;
	value: boolean | string;
}

/**
 * Property groups an instance node may override (provisional section 7). One group per inspector
 * section. TODO(#2): the list is provisional until the maintainer signs off.
 */
export const TOUCHED_GROUPS = [
	'name',
	'visibility',
	'geometry',
	'corners',
	'fills',
	'strokes',
	'effects',
	'blend',
	'auto-layout',
	'text-content',
	'text-style',
	'vector',
	'prototype',
	'component-properties',
	'plugin-data'
] as const;
export type TouchedGroup = (typeof TOUCHED_GROUPS)[number];

// ---------- mixins (section 1) ----------

/** Fields every node has, pages included. */
export interface IdentityProps {
	id: NodeId;
	name: string;
	/** `null` only for pages, which are the roots. */
	parentId: NodeId | null;
	/** Fractional index, sorted lexicographically among siblings. */
	index: string;
	/** Namespaced by plugin id. */
	pluginData: Record<string, Record<string, string>>;
	boundVariables?: BoundVariables;
	/** Counterpart in the main component; set on every node inside an instance. */
	componentRef?: NodeId;
	/** Overridden property groups; set on every node inside an instance. */
	touched?: TouchedGroup[];
	/**
	 * On layers of a main component: component property keys that drive this layer, by what they
	 * drive (`visible`, `characters`, `mainComponent`).
	 */
	componentPropertyReferences?: Partial<Record<ComponentPropertyTarget, string>>;
}
export interface BaseProps extends IdentityProps {
	visible: boolean;
	locked: boolean;
	exportSettings: ExportSetting[];
}
export interface LayoutProps {
	/** Relative to the parent. */
	transform: Matrix2x3;
	width: number;
	height: number;
	minWidth: number | null;
	maxWidth: number | null;
	minHeight: number | null;
	maxHeight: number | null;
	constrainProportions: boolean;
	layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL';
	layoutSizingVertical: 'FIXED' | 'HUG' | 'FILL';
	layoutPositioning: 'AUTO' | 'ABSOLUTE';
}
export interface BlendProps {
	opacity: number;
	blendMode: BlendMode;
	isMask: boolean;
	maskType: 'ALPHA' | 'VECTOR' | 'LUMINANCE';
	effects: Effect[];
	effectStyleId?: string;
}
export interface GeometryProps {
	fills: Paint[];
	strokes: Stroke[];
	fillStyleId?: string;
	strokeStyleId?: string;
}
export interface CornerProps {
	cornerRadius: number | [number, number, number, number];
	cornerSmoothing: number;
}
export interface ConstraintProps {
	constraints: {
		horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
		vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
	};
}
export interface AutoLayoutProps {
	layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
	layoutWrap: 'NO_WRAP' | 'WRAP';
	primaryAxisSizingMode: 'FIXED' | 'AUTO';
	counterAxisSizingMode: 'FIXED' | 'AUTO';
	primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
	counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
	counterAxisAlignContent: 'AUTO' | 'SPACE_BETWEEN';
	itemSpacing: number;
	counterAxisSpacing: number | null;
	paddingTop: number;
	paddingRight: number;
	paddingBottom: number;
	paddingLeft: number;
	itemReverseZIndex: boolean;
	strokesIncludedInLayout: boolean;
	clipsContent: boolean;
	gridRows: GridTrack[];
	gridColumns: GridTrack[];
	gridRowGap: number;
	gridColumnGap: number;
	layoutGrids: LayoutGrid[];
	gridStyleId?: string;
}

// ---------- node types ----------

export const NODE_TYPES = [
	'PAGE',
	'FRAME',
	'GROUP',
	'SECTION',
	'RECTANGLE',
	'ELLIPSE',
	'LINE',
	'POLYGON',
	'STAR',
	'VECTOR',
	'TEXT',
	'BOOLEAN_OPERATION',
	'COMPONENT',
	'COMPONENT_SET',
	'INSTANCE',
	'SLICE'
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Properties shared by all renderable shapes. */
export type ShapeProps = BaseProps &
	LayoutProps &
	BlendProps &
	ConstraintProps & { reactions: Reaction[] };

export type OverflowDirection =
	'NONE' | 'HORIZONTAL_SCROLLING' | 'VERTICAL_SCROLLING' | 'HORIZONTAL_AND_VERTICAL_SCROLLING';

export type FrameLikeProps = ShapeProps &
	GeometryProps &
	CornerProps &
	AutoLayoutProps & {
		guides: Guide[];
		overflowDirection: OverflowDirection;
		numberOfFixedChildren: number;
		explicitVariableModes?: Record<string, string>;
	};

export interface PageNode extends IdentityProps {
	type: 'PAGE';
	parentId: null;
	backgrounds: Paint[];
	guides: Guide[];
	flowStartingPoints: { nodeId: NodeId; name: string }[];
	exportSettings?: ExportSetting[];
	explicitVariableModes?: Record<string, string>;
}
export type FrameNode = FrameLikeProps & { type: 'FRAME' };
export type GroupNode = ShapeProps & { type: 'GROUP' };
export type SectionNode = BaseProps &
	LayoutProps &
	GeometryProps & {
		type: 'SECTION';
		sectionContentsHidden: boolean;
		explicitVariableModes?: Record<string, string>;
	};
export type RectangleNode = ShapeProps & GeometryProps & CornerProps & { type: 'RECTANGLE' };
export type EllipseNode = ShapeProps &
	GeometryProps & {
		type: 'ELLIPSE';
		arcData: { startingAngle: number; endingAngle: number; innerRadius: number };
	};
export type LineNode = ShapeProps & GeometryProps & { type: 'LINE' };
export type PolygonNode = ShapeProps &
	GeometryProps &
	CornerProps & { type: 'POLYGON'; pointCount: number };
export type StarNode = ShapeProps &
	GeometryProps &
	CornerProps & { type: 'STAR'; pointCount: number; innerRadius: number };
export type VectorNode = ShapeProps &
	GeometryProps &
	CornerProps & { type: 'VECTOR'; network: VectorNetwork };
export type TextNode = ShapeProps &
	GeometryProps & {
		type: 'TEXT';
		paragraphs: Paragraph[];
		defaultStyle: TextStyle;
		textAutoResize: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT';
		textTruncation: 'DISABLED' | 'ENDING';
		maxLines: number | null;
		textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM';
		leadingTrim: 'NONE' | 'CAP_HEIGHT';
	};
export type BooleanOperationNode = ShapeProps &
	GeometryProps &
	CornerProps & {
		type: 'BOOLEAN_OPERATION';
		booleanOperation: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE';
	};
export type ComponentNode = FrameLikeProps & {
	type: 'COMPONENT';
	key: string;
	description: string;
	componentPropertyDefinitions: Record<string, ComponentPropertyDefinition>;
	variantProperties?: Record<string, string>;
};
export type ComponentSetNode = FrameLikeProps & {
	type: 'COMPONENT_SET';
	key: string;
	componentPropertyDefinitions: Record<string, ComponentPropertyDefinition>;
};
export type InstanceNode = FrameLikeProps & {
	type: 'INSTANCE';
	mainComponentId: NodeId;
	componentProperties: Record<string, ComponentPropertyValue>;
};
export type SliceNode = BaseProps & LayoutProps & { type: 'SLICE' };

export type SceneNode =
	| FrameNode
	| GroupNode
	| SectionNode
	| RectangleNode
	| EllipseNode
	| LineNode
	| PolygonNode
	| StarNode
	| VectorNode
	| TextNode
	| BooleanOperationNode
	| ComponentNode
	| ComponentSetNode
	| InstanceNode
	| SliceNode;
export type Node = PageNode | SceneNode;

export type NodeOfType<T extends NodeType> = Extract<Node, { type: T }>;

// ---------- styles, assets, file ----------

export type StyleType = 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID';
export interface Style {
	id: string;
	type: StyleType;
	name: string;
	description: string;
	value: unknown;
	boundVariables?: BoundVariables;
}
/** Metadata only; the bytes live in the file's assets table, keyed by hash. */
export interface AssetRecord {
	id: string;
	mime: string;
	width?: number;
	height?: number;
}
export interface FontReference {
	family: string;
	style: string;
	source: 'system' | 'embedded';
}

export interface DesignDocument {
	schemaVersion: number;
	id: string;
	name: string;
	nodes: Record<NodeId, Node>;
	styles: Record<string, Style>;
	variableCollections: Record<string, VariableCollection>;
	variables: Record<string, Variable>;
	assets: Record<string, AssetRecord>;
	fonts: FontReference[];
}
export const SCHEMA_VERSION = 1;

// ---------- changes and transactions (section 5) ----------

export type NodeChange =
	| { t: 'add'; node: Node }
	/** Carries a snapshot so it inverts to `add`. */
	| { t: 'del'; node: Node }
	| { t: 'set'; id: NodeId; set: Record<string, unknown>; prev: Record<string, unknown> }
	| {
			t: 'move';
			id: NodeId;
			parent: NodeId | null;
			index: string;
			prevParent: NodeId | null;
			prevIndex: string;
	  };

export interface EntityMap {
	style: Style;
	variable: Variable;
	collection: VariableCollection;
	asset: AssetRecord;
}
export type EntityKind = keyof EntityMap;
export const ENTITY_KINDS: readonly EntityKind[] = ['style', 'variable', 'collection', 'asset'];

/** Same add / del / set shapes as nodes, for the library tables. */
export type EntityChange<K extends EntityKind = EntityKind> = K extends EntityKind
	? | { t: 'entity-add'; kind: K; entity: EntityMap[K] }
		| { t: 'entity-del'; kind: K; entity: EntityMap[K] }
		| {
				t: 'entity-set';
				kind: K;
				id: string;
				set: Record<string, unknown>;
				prev: Record<string, unknown>;
		  }
	: never;

export type Change = NodeChange | EntityChange;

export type ChangeOrigin = 'user' | 'plugin' | 'ai' | 'sync';
export interface Transaction {
	id: string;
	origin: ChangeOrigin;
	label: string;
	changes: Change[];
	undo: Change[];
	/** Coalesces consecutive transactions with the same key (nudges, typing). */
	mergeKey?: string;
}
