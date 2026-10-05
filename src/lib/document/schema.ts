// Runtime validators for the persisted model in types.ts. Used at IPC and plugin boundaries and
// when loading files. Objects are strict: unknown keys (derived data, typos) are rejected rather
// than silently dropped. Each exported schema is annotated with its type, so a drift between
// types.ts and this file fails `bun run check`.

import { z } from 'zod';
import {
	BLEND_MODES,
	TOUCHED_GROUPS,
	type Action,
	type Change,
	type DesignDocument,
	type Effect,
	type EntityChange,
	type Node,
	type NodeChange,
	type Paint,
	type Paragraph,
	type Reaction,
	type TextLineHeight,
	type TextRun,
	type TextStyle,
	type Transaction,
	type Trigger,
	type VariableValue
} from './types';

const unit = z.number().min(0).max(1);
const nodeId = z.string().min(1);
const strictObject = z.strictObject;

const rgb = strictObject({ r: unit, g: unit, b: unit });
const rgba = strictObject({ r: unit, g: unit, b: unit, a: unit });
const vec2 = strictObject({ x: z.number(), y: z.number() });
const matrixRow = z.tuple([z.number(), z.number(), z.number()]);
const matrix2x3 = z.tuple([matrixRow, matrixRow]);
const blendMode = z.enum(BLEND_MODES);

const variableAlias = strictObject({ type: z.literal('VARIABLE_ALIAS'), id: z.string() });
const boundVariables = z.record(z.string(), z.union([variableAlias, z.array(variableAlias)]));
const stringRecord = z.record(z.string(), z.string());

// ---------- variables ----------

export const variableValueSchema: z.ZodType<VariableValue> = z.union([
	z.boolean(),
	z.number(),
	z.string(),
	rgba,
	variableAlias
]);
export const variableSchema = strictObject({
	id: z.string(),
	name: z.string(),
	collectionId: z.string(),
	resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR']),
	valuesByMode: z.record(z.string(), variableValueSchema),
	scopes: z.array(z.string()),
	codeSyntax: strictObject({
		WEB: z.string().optional(),
		ANDROID: z.string().optional(),
		iOS: z.string().optional()
	}),
	description: z.string()
});
export const variableCollectionSchema = strictObject({
	id: z.string(),
	name: z.string(),
	modes: z.array(strictObject({ modeId: z.string(), name: z.string() })),
	defaultModeId: z.string(),
	variableIds: z.array(z.string())
});

// ---------- paints, effects, strokes ----------

const paintBase = {
	visible: z.boolean(),
	opacity: unit,
	blendMode,
	boundVariables: boundVariables.optional()
};
export const paintSchema: z.ZodType<Paint> = z.discriminatedUnion('type', [
	strictObject({ ...paintBase, type: z.literal('SOLID'), color: rgb }),
	strictObject({
		...paintBase,
		type: z.enum(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']),
		gradientTransform: matrix2x3,
		gradientStops: z.array(
			strictObject({ position: unit, color: rgba, boundVariables: boundVariables.optional() })
		)
	}),
	strictObject({
		...paintBase,
		type: z.literal('IMAGE'),
		imageHash: z.string(),
		scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']),
		imageTransform: matrix2x3.optional(),
		scalingFactor: z.number().optional(),
		rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
		filters: strictObject({
			exposure: z.number().optional(),
			contrast: z.number().optional(),
			saturation: z.number().optional(),
			temperature: z.number().optional(),
			tint: z.number().optional(),
			highlights: z.number().optional(),
			shadows: z.number().optional()
		}).optional()
	})
]);

export const effectSchema: z.ZodType<Effect> = z.union([
	strictObject({
		type: z.enum(['DROP_SHADOW', 'INNER_SHADOW']),
		visible: z.boolean(),
		color: rgba,
		offset: vec2,
		radius: z.number().min(0),
		spread: z.number(),
		blendMode,
		showShadowBehindNode: z.boolean().optional(),
		boundVariables: boundVariables.optional()
	}),
	strictObject({
		type: z.enum(['LAYER_BLUR', 'BACKGROUND_BLUR']),
		visible: z.boolean(),
		radius: z.number().min(0),
		blurType: z.enum(['NORMAL', 'PROGRESSIVE']).optional(),
		startRadius: z.number().optional(),
		startOffset: vec2.optional(),
		endOffset: vec2.optional(),
		boundVariables: boundVariables.optional()
	})
]);

const strokeSchema = strictObject({
	paints: z.array(paintSchema),
	weight: z.union([
		z.number().min(0),
		strictObject({
			top: z.number().min(0),
			right: z.number().min(0),
			bottom: z.number().min(0),
			left: z.number().min(0)
		})
	]),
	align: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']),
	cap: z.enum(['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL']),
	join: z.enum(['MITER', 'BEVEL', 'ROUND']),
	miterLimit: z.number(),
	dashPattern: z.array(z.number())
});

const layoutGridSchema = strictObject({
	pattern: z.enum(['GRID', 'COLUMNS', 'ROWS']),
	visible: z.boolean(),
	color: rgba,
	sectionSize: z.number().optional(),
	alignment: z.enum(['MIN', 'MAX', 'CENTER', 'STRETCH']).optional(),
	gutterSize: z.number().optional(),
	offset: z.number().optional(),
	count: z.number().optional()
});
const guideSchema = strictObject({ axis: z.enum(['X', 'Y']), offset: z.number() });
const gridTrackSchema = strictObject({
	type: z.enum(['FLEX', 'FIXED', 'HUG']),
	value: z.number().optional()
});
const exportSettingSchema = strictObject({
	suffix: z.string(),
	format: z.enum(['PNG', 'JPG', 'SVG', 'PDF', 'WEBP']),
	constraint: strictObject({ type: z.enum(['SCALE', 'WIDTH', 'HEIGHT']), value: z.number() })
});

// ---------- prototyping ----------

const triggerSchema: z.ZodType<Trigger> = z.union([
	strictObject({ type: z.enum(['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG']) }),
	strictObject({ type: z.literal('AFTER_TIMEOUT'), timeout: z.number() }),
	strictObject({
		type: z.literal('ON_KEY_DOWN'),
		device: z.enum(['KEYBOARD', 'GAMEPAD']),
		keyCodes: z.array(z.number())
	})
]);
const transitionSchema = strictObject({
	type: z.enum([
		'DISSOLVE',
		'SMART_ANIMATE',
		'SCROLL_ANIMATE',
		'MOVE_IN',
		'MOVE_OUT',
		'PUSH',
		'SLIDE_IN',
		'SLIDE_OUT'
	]),
	direction: z.enum(['LEFT', 'RIGHT', 'TOP', 'BOTTOM']).optional(),
	duration: z.number().min(0),
	easing: strictObject({
		type: z.string(),
		bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
	}),
	matchLayers: z.boolean().optional()
});
const actionSchema: z.ZodType<Action> = z.union([
	strictObject({ type: z.enum(['BACK', 'CLOSE']) }),
	strictObject({
		type: z.literal('URL'),
		url: z.string(),
		openInNewTab: z.boolean().optional()
	}),
	strictObject({
		type: z.literal('NODE'),
		destinationId: nodeId.nullable(),
		navigation: z.enum(['NAVIGATE', 'SWAP', 'OVERLAY', 'SCROLL_TO', 'CHANGE_TO']),
		transition: transitionSchema.optional(),
		preserveScrollPosition: z.boolean().optional()
	}),
	strictObject({
		type: z.literal('SET_VARIABLE'),
		variableId: z.string(),
		value: variableValueSchema
	})
]);
const reactionSchema: z.ZodType<Reaction> = strictObject({
	trigger: triggerSchema.nullable(),
	actions: z.array(actionSchema)
});

// ---------- text ----------

const textMeasure = strictObject({ value: z.number(), unit: z.enum(['PIXELS', 'PERCENT']) });
const lineHeight: z.ZodType<TextLineHeight> = z.union([
	textMeasure,
	strictObject({ unit: z.literal('AUTO') })
]);
const textStyleShape = {
	fontName: strictObject({ family: z.string(), style: z.string() }),
	fontWeight: z.number(),
	fontSize: z.number().positive(),
	letterSpacing: textMeasure,
	lineHeight,
	textCase: z.enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED']),
	textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']),
	openTypeFeatures: z.record(z.string(), z.boolean()),
	fontVariations: z.record(z.string(), z.number()),
	fills: z.array(paintSchema),
	hyperlink: strictObject({ type: z.enum(['URL', 'NODE']), value: z.string() }).optional(),
	textStyleId: z.string().optional(),
	boundVariables: boundVariables.optional()
};
export const textStyleSchema: z.ZodType<TextStyle> = strictObject(textStyleShape);
export const textRunSchema: z.ZodType<TextRun> = strictObject({
	text: z.string(),
	style: strictObject(textStyleShape).partial()
});
export const paragraphSchema: z.ZodType<Paragraph> = strictObject({
	runs: z.array(textRunSchema),
	align: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']),
	indent: z.number(),
	spacingAfter: z.number(),
	list: z.enum(['NONE', 'ORDERED', 'UNORDERED']),
	listLevel: z.number().int().min(0)
});

// ---------- vectors ----------

const vectorNetworkSchema = strictObject({
	vertices: z.array(
		strictObject({
			x: z.number(),
			y: z.number(),
			strokeCap: z.string().optional(),
			strokeJoin: z.string().optional(),
			cornerRadius: z.number().optional(),
			handleMirroring: z.enum(['NONE', 'ANGLE', 'ANGLE_AND_LENGTH']).optional()
		})
	),
	segments: z.array(
		strictObject({
			start: z.number().int().min(0),
			end: z.number().int().min(0),
			tangentStart: vec2.optional(),
			tangentEnd: vec2.optional()
		})
	),
	regions: z
		.array(
			strictObject({
				windingRule: z.enum(['NONZERO', 'EVENODD']),
				loops: z.array(z.array(z.number().int().min(0))),
				fills: z.array(paintSchema).optional()
			})
		)
		.optional()
});

// ---------- components ----------

const componentPropertyType = z.enum(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT', 'SLOT']);
const componentPropertyDefinition = strictObject({
	type: componentPropertyType,
	defaultValue: z.union([z.boolean(), z.string()]),
	variantOptions: z.array(z.string()).optional(),
	preferredValues: z
		.array(strictObject({ type: z.enum(['COMPONENT', 'COMPONENT_SET']), key: z.string() }))
		.optional()
});
const componentPropertyValue = strictObject({
	type: componentPropertyType,
	value: z.union([z.boolean(), z.string()])
});
const touchedGroup = z.enum(TOUCHED_GROUPS);

// ---------- mixins ----------

const identityShape = {
	id: nodeId,
	name: z.string(),
	index: z.string(),
	pluginData: z.record(z.string(), stringRecord),
	boundVariables: boundVariables.optional(),
	componentRef: nodeId.optional(),
	touched: z.array(touchedGroup).optional()
};
const baseShape = {
	...identityShape,
	parentId: nodeId.nullable(),
	visible: z.boolean(),
	locked: z.boolean(),
	exportSettings: z.array(exportSettingSchema)
};
const layoutShape = {
	transform: matrix2x3,
	width: z.number().min(0),
	height: z.number().min(0),
	minWidth: z.number().nullable(),
	maxWidth: z.number().nullable(),
	minHeight: z.number().nullable(),
	maxHeight: z.number().nullable(),
	constrainProportions: z.boolean(),
	layoutSizingHorizontal: z.enum(['FIXED', 'HUG', 'FILL']),
	layoutSizingVertical: z.enum(['FIXED', 'HUG', 'FILL']),
	layoutPositioning: z.enum(['AUTO', 'ABSOLUTE'])
};
const blendShape = {
	opacity: unit,
	blendMode,
	isMask: z.boolean(),
	maskType: z.enum(['ALPHA', 'VECTOR', 'LUMINANCE']),
	effects: z.array(effectSchema),
	effectStyleId: z.string().optional()
};
const geometryShape = {
	fills: z.array(paintSchema),
	strokes: z.array(strokeSchema),
	fillStyleId: z.string().optional(),
	strokeStyleId: z.string().optional()
};
const cornerShape = {
	cornerRadius: z.union([
		z.number().min(0),
		z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)])
	]),
	cornerSmoothing: unit
};
const constraintAxis = z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);
const constraintShape = {
	constraints: strictObject({ horizontal: constraintAxis, vertical: constraintAxis })
};
const autoLayoutShape = {
	layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']),
	layoutWrap: z.enum(['NO_WRAP', 'WRAP']),
	primaryAxisSizingMode: z.enum(['FIXED', 'AUTO']),
	counterAxisSizingMode: z.enum(['FIXED', 'AUTO']),
	primaryAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']),
	counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']),
	counterAxisAlignContent: z.enum(['AUTO', 'SPACE_BETWEEN']),
	itemSpacing: z.number(),
	counterAxisSpacing: z.number().nullable(),
	paddingTop: z.number().min(0),
	paddingRight: z.number().min(0),
	paddingBottom: z.number().min(0),
	paddingLeft: z.number().min(0),
	itemReverseZIndex: z.boolean(),
	strokesIncludedInLayout: z.boolean(),
	clipsContent: z.boolean(),
	gridRows: z.array(gridTrackSchema),
	gridColumns: z.array(gridTrackSchema),
	gridRowGap: z.number(),
	gridColumnGap: z.number(),
	layoutGrids: z.array(layoutGridSchema)
};
const variableModes = z.record(z.string(), z.string()).optional();

const shapeShape = {
	...baseShape,
	...layoutShape,
	...blendShape,
	...constraintShape,
	reactions: z.array(reactionSchema)
};
const frameLikeShape = {
	...shapeShape,
	...geometryShape,
	...cornerShape,
	...autoLayoutShape,
	guides: z.array(guideSchema),
	overflowDirection: z.enum([
		'NONE',
		'HORIZONTAL_SCROLLING',
		'VERTICAL_SCROLLING',
		'HORIZONTAL_AND_VERTICAL_SCROLLING'
	]),
	numberOfFixedChildren: z.number().int().min(0),
	explicitVariableModes: variableModes
};

// ---------- nodes ----------

const pageSchema = strictObject({
	...identityShape,
	type: z.literal('PAGE'),
	parentId: z.null(),
	backgrounds: z.array(paintSchema),
	guides: z.array(guideSchema),
	flowStartingPoints: z.array(strictObject({ nodeId, name: z.string() })),
	exportSettings: z.array(exportSettingSchema).optional(),
	explicitVariableModes: variableModes
});

export const nodeSchema: z.ZodType<Node> = z.discriminatedUnion('type', [
	pageSchema,
	strictObject({ ...frameLikeShape, type: z.literal('FRAME') }),
	strictObject({ ...shapeShape, type: z.literal('GROUP') }),
	strictObject({
		...baseShape,
		...layoutShape,
		...geometryShape,
		type: z.literal('SECTION'),
		sectionContentsHidden: z.boolean(),
		explicitVariableModes: variableModes
	}),
	strictObject({
		...shapeShape,
		...geometryShape,
		...cornerShape,
		type: z.literal('RECTANGLE')
	}),
	strictObject({
		...shapeShape,
		...geometryShape,
		type: z.literal('ELLIPSE'),
		arcData: strictObject({
			startingAngle: z.number(),
			endingAngle: z.number(),
			innerRadius: unit
		})
	}),
	strictObject({ ...shapeShape, ...geometryShape, type: z.literal('LINE') }),
	strictObject({
		...shapeShape,
		...geometryShape,
		...cornerShape,
		type: z.literal('POLYGON'),
		pointCount: z.number().int().min(3)
	}),
	strictObject({
		...shapeShape,
		...geometryShape,
		...cornerShape,
		type: z.literal('STAR'),
		pointCount: z.number().int().min(3),
		innerRadius: unit
	}),
	strictObject({
		...shapeShape,
		...geometryShape,
		...cornerShape,
		type: z.literal('VECTOR'),
		network: vectorNetworkSchema
	}),
	strictObject({
		...shapeShape,
		...geometryShape,
		type: z.literal('TEXT'),
		paragraphs: z.array(paragraphSchema).min(1),
		defaultStyle: textStyleSchema,
		textAutoResize: z.enum(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT']),
		textTruncation: z.enum(['DISABLED', 'ENDING']),
		maxLines: z.number().int().positive().nullable(),
		textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']),
		leadingTrim: z.enum(['NONE', 'CAP_HEIGHT'])
	}),
	strictObject({
		...shapeShape,
		...geometryShape,
		...cornerShape,
		type: z.literal('BOOLEAN_OPERATION'),
		booleanOperation: z.enum(['UNION', 'INTERSECT', 'SUBTRACT', 'EXCLUDE'])
	}),
	strictObject({
		...frameLikeShape,
		type: z.literal('COMPONENT'),
		key: z.string(),
		description: z.string(),
		componentPropertyDefinitions: z.record(z.string(), componentPropertyDefinition),
		variantProperties: stringRecord.optional()
	}),
	strictObject({
		...frameLikeShape,
		type: z.literal('COMPONENT_SET'),
		key: z.string(),
		componentPropertyDefinitions: z.record(z.string(), componentPropertyDefinition)
	}),
	strictObject({
		...frameLikeShape,
		type: z.literal('INSTANCE'),
		mainComponentId: nodeId,
		componentProperties: z.record(z.string(), componentPropertyValue)
	}),
	strictObject({ ...baseShape, ...layoutShape, type: z.literal('SLICE') })
]);

// ---------- styles, assets, file ----------

export const styleSchema = strictObject({
	id: z.string(),
	type: z.enum(['PAINT', 'TEXT', 'EFFECT', 'GRID']),
	name: z.string(),
	description: z.string(),
	value: z.unknown(),
	boundVariables: boundVariables.optional()
});
export const assetRecordSchema = strictObject({
	id: z.string(),
	mime: z.string(),
	width: z.number().optional(),
	height: z.number().optional()
});

export const designDocumentSchema: z.ZodType<DesignDocument> = strictObject({
	schemaVersion: z.number().int().positive(),
	id: z.string(),
	name: z.string(),
	nodes: z.record(nodeId, nodeSchema),
	styles: z.record(z.string(), styleSchema),
	variableCollections: z.record(z.string(), variableCollectionSchema),
	variables: z.record(z.string(), variableSchema),
	assets: z.record(z.string(), assetRecordSchema),
	fonts: z.array(
		strictObject({
			family: z.string(),
			style: z.string(),
			source: z.enum(['system', 'embedded'])
		})
	)
});

// ---------- changes ----------

const propertyMap = z.record(z.string(), z.unknown());

export const nodeChangeSchema: z.ZodType<NodeChange> = z.discriminatedUnion('t', [
	strictObject({ t: z.literal('add'), node: nodeSchema }),
	strictObject({ t: z.literal('del'), node: nodeSchema }),
	strictObject({ t: z.literal('set'), id: nodeId, set: propertyMap, prev: propertyMap }),
	strictObject({
		t: z.literal('move'),
		id: nodeId,
		parent: nodeId.nullable(),
		index: z.string(),
		prevParent: nodeId.nullable(),
		prevIndex: z.string()
	})
]);

function entityChangeVariants<Entity extends z.ZodType>(
	kind: string,
	entity: Entity
): z.ZodType<unknown>[] {
	const kindLiteral = z.literal(kind);
	return [
		strictObject({ t: z.literal('entity-add'), kind: kindLiteral, entity }),
		strictObject({ t: z.literal('entity-del'), kind: kindLiteral, entity }),
		strictObject({
			t: z.literal('entity-set'),
			kind: kindLiteral,
			id: z.string(),
			set: propertyMap,
			prev: propertyMap
		})
	];
}

const entityChangeUnion = z.union([
	...entityChangeVariants('style', styleSchema),
	...entityChangeVariants('variable', variableSchema),
	...entityChangeVariants('collection', variableCollectionSchema),
	...entityChangeVariants('asset', assetRecordSchema)
] as [z.ZodType, z.ZodType, ...z.ZodType[]]);
export const entityChangeSchema = entityChangeUnion as z.ZodType<EntityChange>;

export const changeSchema: z.ZodType<Change> = z.union([nodeChangeSchema, entityChangeSchema]);

export const transactionSchema: z.ZodType<Transaction> = strictObject({
	id: z.string(),
	origin: z.enum(['user', 'plugin', 'ai', 'sync']),
	label: z.string(),
	changes: z.array(changeSchema),
	undo: z.array(changeSchema),
	mergeKey: z.string().optional(),
	runId: z.string().optional()
});

// ---------- entry points ----------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
	const result = schema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
	return { ok: false, message: z.prettifyError(result.error) };
}

export function parseNode(input: unknown): ParseResult<Node> {
	return parseWith(nodeSchema, input);
}
export function parseChange(input: unknown): ParseResult<Change> {
	return parseWith(changeSchema, input);
}
export function parseTransaction(input: unknown): ParseResult<Transaction> {
	return parseWith(transactionSchema, input);
}
export function parseDesignDocument(input: unknown): ParseResult<DesignDocument> {
	return parseWith(designDocumentSchema, input);
}

// TODO(#2): cycle prevention (component containing its own instance) is enforced at write time in
// `document.apply`, not by these structural validators.
