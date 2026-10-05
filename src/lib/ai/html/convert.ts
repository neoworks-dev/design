// A measured HTML snapshot to document nodes. Pure: no DOM except what `importSvg` needs for
// inline SVG.
//
// What becomes what:
//   element with only inline text, no box decoration  TEXT (runs from the inline elements)
//   element with text and a background/border/padding  FRAME with auto layout around a TEXT
//   element with children                             FRAME
//   element with neither                              RECTANGLE (ELLIPSE when fully round)
//   inline <svg>                                      the SVG importer's frame of vectors
//
// Layout. A flex container becomes auto layout (direction, wrap, gap, padding, alignment). A
// block container becomes vertical auto layout when its children are stacked with even spacing
// and share an alignment; otherwise its children keep the positions the browser gave them.
// Sizing (hug / fill / fixed) comes from the probes the measuring step ran. CSS borders take
// space and Figma strokes do not, so auto layout padding includes the border width.

import {
	BLEND_MODES,
	createNode,
	defaultTextStyle,
	generateNodeId,
	invertMatrix,
	normalizeParagraphs,
	rebalancedKeys,
	translationMatrix,
	emptyParagraph,
	type BlendMode,
	type BoundVariables,
	type Effect,
	type FrameNode,
	type GradientPaint,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Paint,
	type Paragraph,
	type Rect,
	type RGBA,
	type Stroke,
	type TextNode,
	type TextRun,
	type TextStyle,
	type Vec2
} from '../../document';
import { deepEqual } from '../../document/text';
import { importSvg } from '../../svg/importSvg';
import { linearMatrix, radialMatrix } from '../../svg/gradients';
import { styleName } from '../../text/fontFace';
import type {
	BackgroundLayer,
	ColorStopSnapshot,
	ElementSnapshot,
	FontSnapshot,
	HtmlSnapshot,
	NodeSnapshot,
	RunSnapshot,
	StyleSnapshot,
	TextLeafSnapshot,
	TextSnapshot
} from './snapshot';

export interface ConvertOptions {
	/** The node the roots are inserted under. */
	parentId: NodeId;
	/** Where the first root's top left corner lands, in the parent's coordinates. */
	origin: Vec2;
	generateId?: () => NodeId;
	/** CSS variable name (`--surface`) to document variable id; used ones become bindings. */
	variables?: Readonly<Record<string, string>>;
	/** Font families the document can draw; others are kept but reported. */
	availableFamilies?: ReadonlySet<string>;
}

export interface ConvertResult {
	/** Parents before children. Roots carry `parentId` from the options and placeholder indexes. */
	nodes: Node[];
	rootIds: NodeId[];
	/** `data-id` attributes to the ids of the nodes made from those elements. */
	idsByDataId: Record<string, NodeId>;
	warnings: string[];
}

type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';
type Sizing = 'FIXED' | 'HUG' | 'FILL';

interface ParentInfo {
	id: NodeId;
	box: Rect;
	layout: LayoutMode;
	hugsWidth: boolean;
	hugsHeight: boolean;
	/** The container's counter axis alignment, for `align-self` on text. */
	counterAlign: FrameNode['counterAxisAlignItems'];
}

interface AutoLayout {
	layoutMode: LayoutMode;
	layoutWrap: FrameNode['layoutWrap'];
	itemSpacing: number;
	counterAxisSpacing: number | null;
	primaryAxisAlignItems: FrameNode['primaryAxisAlignItems'];
	counterAxisAlignItems: FrameNode['counterAxisAlignItems'];
	paddingTop: number;
	paddingRight: number;
	paddingBottom: number;
	paddingLeft: number;
	/** In-flow children in visual order, then absolutely positioned ones. */
	children: NodeSnapshot[];
}

const EVEN = 0.5;
/** Form controls centre their single line of text vertically. */
const CENTERED_CONTROLS = new Set(['input', 'select', 'button']);
const PLACEHOLDER_IMAGE: RGBA = { r: 0.9, g: 0.9, b: 0.9, a: 1 };

const TAG_NAMES: Record<string, string> = {
	page: 'Page',
	button: 'Button',
	nav: 'Nav',
	header: 'Header',
	footer: 'Footer',
	main: 'Main',
	section: 'Section',
	article: 'Article',
	aside: 'Aside',
	ul: 'List',
	ol: 'List',
	li: 'List item',
	form: 'Form',
	input: 'Input',
	img: 'Image',
	hr: 'Divider',
	a: 'Link'
};

const JUSTIFY: Record<string, FrameNode['primaryAxisAlignItems']> = {
	center: 'CENTER',
	'flex-end': 'MAX',
	end: 'MAX',
	right: 'MAX',
	'space-between': 'SPACE_BETWEEN',
	'space-around': 'SPACE_BETWEEN',
	'space-evenly': 'SPACE_BETWEEN'
};

const ALIGN: Record<string, FrameNode['counterAxisAlignItems']> = {
	center: 'CENTER',
	'flex-end': 'MAX',
	end: 'MAX',
	'self-end': 'MAX',
	baseline: 'BASELINE',
	'first baseline': 'BASELINE'
};

const TEXT_ALIGN: Record<string, Paragraph['align']> = {
	center: 'CENTER',
	right: 'RIGHT',
	end: 'RIGHT',
	justify: 'JUSTIFIED'
};

const TEXT_CASE: Record<string, TextStyle['textCase']> = {
	uppercase: 'UPPER',
	lowercase: 'LOWER',
	capitalize: 'TITLE'
};

const DECORATION: Record<string, TextStyle['textDecoration']> = {
	underline: 'UNDERLINE',
	'line-through': 'STRIKETHROUGH'
};

function near(left: number, right: number): boolean {
	return Math.abs(left - right) <= EVEN;
}

function allNear(values: readonly number[]): boolean {
	if (values.length === 0) return true;
	return values.every((value) => near(value, values[0]));
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function right(box: Rect): number {
	return box.x + box.width;
}

function bottom(box: Rect): number {
	return box.y + box.height;
}

function boxOf(snapshot: NodeSnapshot): Rect {
	if (snapshot.kind === 'text') return snapshot.text.box;
	return snapshot.box;
}

function isAbsolute(snapshot: NodeSnapshot): boolean {
	if (snapshot.kind === 'text') return false;
	return snapshot.style.position === 'absolute' || snapshot.style.position === 'fixed';
}

function alias(id: string): BoundVariables[string] {
	return { type: 'VARIABLE_ALIAS', id };
}

function solid(color: RGBA): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: round(color.a),
		blendMode: 'NORMAL',
		color: { r: color.r, g: color.g, b: color.b }
	};
}

function plainTextOf(text: TextSnapshot): string {
	return text.paragraphs
		.map((runs) => runs.map((run) => run.text).join(''))
		.join(' ')
		.trim();
}

function hasBorder(style: StyleSnapshot): boolean {
	if (style.borderStyle === 'none' || style.borderStyle === 'hidden') return false;
	if (style.borderColor === null || style.borderColor.a === 0) return false;
	const widths = style.borderWidth;
	return widths.top > 0 || widths.right > 0 || widths.bottom > 0 || widths.left > 0;
}

function hasPadding(style: StyleSnapshot): boolean {
	const padding = style.padding;
	return padding.top > 0 || padding.right > 0 || padding.bottom > 0 || padding.left > 0;
}

function hasBackground(style: StyleSnapshot): boolean {
	if (style.backgroundLayers.length > 0) return true;
	return style.background !== null && style.background.a > 0;
}

function isFlex(style: StyleSnapshot): boolean {
	return style.display === 'flex' || style.display === 'inline-flex';
}

function isPlainText(element: ElementSnapshot): boolean {
	return element.text !== undefined && element.children.length === 0 && !isDecorated(element);
}

/** Text that needs a box around it: a frame holds the decoration, a text layer the words. */
function isDecorated(element: ElementSnapshot): boolean {
	const style = element.style;
	if (hasBackground(style) || hasBorder(style) || hasPadding(style)) return true;
	if (style.shadows.length > 0 || isFlex(style)) return true;
	return false;
}

function blendModeOf(css: string, container: boolean): BlendMode {
	if (css === 'normal' || css === '') {
		if (container) return 'PASS_THROUGH';
		return 'NORMAL';
	}
	if (css === 'plus-lighter') return 'LINEAR_DODGE';
	const mode = css.toUpperCase().replaceAll('-', '_');
	if ((BLEND_MODES as readonly string[]).includes(mode)) return mode as BlendMode;
	return 'NORMAL';
}

class Converter {
	readonly nodes: Node[] = [];
	readonly warnings: string[] = [];
	readonly idsByDataId: Record<string, NodeId> = {};
	private readonly reportedFamilies = new Set<string>();
	private readonly generateId: () => NodeId;

	constructor(private readonly options: ConvertOptions) {
		if (options.generateId) this.generateId = options.generateId;
		else this.generateId = generateNodeId;
	}

	warn(message: string): void {
		if (!this.warnings.includes(message)) this.warnings.push(message);
	}

	// ---------- elements ----------

	element(element: ElementSnapshot, parent: ParentInfo, index: string, transform: Matrix2x3): void {
		if (element.svg !== undefined) {
			this.svg(element, element.svg, parent, index, transform);
			return;
		}
		if (element.attributes['data-component'] !== undefined) {
			this.warn(
				`data-component="${element.attributes['data-component']}": instances are not supported yet, drawn as plain layers`
			);
		}
		if (element.tag === 'img') {
			this.warn('images are not imported yet: <img> became a grey placeholder');
		}
		const hasChildren = element.children.length > 0;
		if (element.text !== undefined && !hasChildren && !isDecorated(element)) {
			this.textElement(element, element.text, parent, index, transform);
			return;
		}
		if (!hasChildren && element.text === undefined) {
			this.shape(element, parent, index, transform);
			return;
		}
		this.frame(element, parent, index, transform);
	}

	private idFor(element: ElementSnapshot): NodeId {
		const id = this.generateId();
		const dataId = element.attributes['data-id'];
		if (dataId !== undefined) this.idsByDataId[dataId] = id;
		return id;
	}

	private nameOf(element: ElementSnapshot, fallback: string): string {
		for (const attribute of ['data-name', 'aria-label', 'alt']) {
			const explicit = element.attributes[attribute];
			if (explicit !== undefined && explicit.trim() !== '') return explicit.trim();
		}
		if (element.text !== undefined) {
			const text = plainTextOf(element.text);
			if (text !== '') return text.slice(0, 40);
		}
		if (element.attributes.id !== undefined) return element.attributes.id;
		const className = element.attributes.class;
		if (className !== undefined && className.trim() !== '') return className.trim().split(/\s+/)[0];
		const byTag = TAG_NAMES[element.tag];
		if (byTag !== undefined) return byTag;
		if (/^h[1-6]$/.test(element.tag)) return 'Heading';
		return fallback;
	}

	/** Visibility, opacity, blend mode and effects: what every layer made from an element shares. */
	private appearance(element: ElementSnapshot, container: boolean): Record<string, unknown> {
		const style = element.style;
		const props: Record<string, unknown> = {
			visible: style.visible,
			opacity: round(style.opacity),
			blendMode: blendModeOf(style.blendMode, container),
			effects: this.effects(style)
		};
		const boundVariables = this.nodeBindings(element, ['opacity', 'width', 'height']);
		if (boundVariables !== undefined) props.boundVariables = boundVariables;
		return props;
	}

	private axisSizing(
		element: ElementSnapshot,
		parent: ParentInfo,
		axis: 'width' | 'height',
		canHug: boolean
	): Sizing {
		const measured = element.sizing[axis];
		const inAutoLayout = parent.layout !== 'NONE' && !isAbsolute(element);
		const parentHugs = axis === 'width' ? parent.hugsWidth : parent.hugsHeight;
		const mainAxis =
			(axis === 'width' && parent.layout === 'HORIZONTAL') ||
			(axis === 'height' && parent.layout === 'VERTICAL');
		const grows = mainAxis && element.style.flexGrow > 0;
		if (inAutoLayout && !parentHugs && (grows || measured === 'fill')) return 'FILL';
		if (measured === 'hug' && canHug) return 'HUG';
		return 'FIXED';
	}

	private placement(
		element: ElementSnapshot,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3,
		canHug: boolean
	): Record<string, unknown> {
		return {
			parentId: parent.id,
			index,
			transform,
			width: round(element.box.width),
			height: round(element.box.height),
			layoutPositioning: parent.layout !== 'NONE' && isAbsolute(element) ? 'ABSOLUTE' : 'AUTO',
			layoutSizingHorizontal: this.axisSizing(element, parent, 'width', canHug),
			layoutSizingVertical: this.axisSizing(element, parent, 'height', canHug),
			minWidth: element.style.minWidth,
			maxWidth: element.style.maxWidth,
			minHeight: element.style.minHeight,
			maxHeight: element.style.maxHeight
		};
	}

	private shape(
		element: ElementSnapshot,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3
	): void {
		const style = element.style;
		const box = element.box;
		const limit = Math.min(box.width, box.height) / 2;
		const round_ =
			style.radii.every((radius) => radius >= limit - EVEN) && near(box.width, box.height);
		let fills = this.fills(element);
		if (element.tag === 'img') fills = [solid(PLACEHOLDER_IMAGE)];
		const common = {
			id: this.idFor(element),
			name: this.nameOf(element, round_ ? 'Ellipse' : 'Rectangle'),
			...this.placement(element, parent, index, transform, false),
			...this.appearance(element, false),
			fills,
			strokes: this.strokes(style)
		};
		if (round_ && limit > 0) {
			this.nodes.push(createNode('ELLIPSE', common));
			return;
		}
		this.nodes.push(
			createNode('RECTANGLE', { ...common, cornerRadius: this.cornerRadius(element) })
		);
	}

	private svg(
		element: ElementSnapshot,
		markup: string,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3
	): void {
		const name = this.nameOf(element, 'Icon');
		const imported = importSvg(markup, { name });
		if (imported === null) {
			this.warn(`an inline <svg> could not be read`);
			this.shape(element, parent, index, transform);
			return;
		}
		for (const warning of imported.warnings) this.warn(`svg: ${warning}`);
		// The <svg> element's own box decoration goes on the frame; its drawing sits inside the
		// padding and border, as the browser lays it out.
		const style = element.style;
		const insetX = style.padding.left + style.borderWidth.left;
		const insetY = style.padding.top + style.borderWidth.top;
		for (const node of imported.nodes) {
			if (node.id === imported.rootId) {
				this.nodes.push(this.svgRoot(element, node, parent, index, transform));
				continue;
			}
			if (node.parentId !== imported.rootId || !('transform' in node)) {
				this.nodes.push(node);
				continue;
			}
			const [[a, b, x], [c, d, y]] = node.transform;
			this.nodes.push({
				...node,
				transform: [
					[a, b, round(x + insetX)],
					[c, d, round(y + insetY)]
				]
			});
		}
	}

	private svgRoot(
		element: ElementSnapshot,
		root: Node,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3
	): Node {
		const dataId = element.attributes['data-id'];
		if (dataId !== undefined) this.idsByDataId[dataId] = root.id;
		const decorated = {
			...root,
			...this.placement(element, parent, index, transform, false),
			...this.appearance(element, true),
			fills: this.fills(element),
			strokes: this.strokes(element.style),
			cornerRadius: this.cornerRadius(element),
			clipsContent: element.style.clips
		};
		return decorated as Node;
	}

	// ---------- frames and layout ----------

	private frame(
		element: ElementSnapshot,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3
	): void {
		const style = element.style;
		const id = this.idFor(element);
		const name = this.nameOf(element, 'Frame');
		let layout = this.flexLayout(element);
		if (layout === null && element.text !== undefined) layout = this.textBoxLayout(element);
		if (layout === null) layout = this.stackLayout(element);
		const placement = this.placement(
			element,
			parent,
			index,
			transform,
			layout.layoutMode !== 'NONE'
		);
		const horizontal = placement.layoutSizingHorizontal;
		const vertical = placement.layoutSizingVertical;
		let primaryHug = horizontal === 'HUG';
		let counterHug = vertical === 'HUG';
		if (layout.layoutMode === 'VERTICAL') {
			primaryHug = vertical === 'HUG';
			counterHug = horizontal === 'HUG';
		}
		const { children, ...autoLayout } = layout;
		const bindings = this.nodeBindings(element, ['opacity', 'width', 'height']);
		const layoutBindings = this.layoutBindings(element, layout.layoutMode);
		const node = createNode('FRAME', {
			id,
			name,
			...placement,
			...this.appearance(element, true),
			...autoLayout,
			primaryAxisSizingMode: primaryHug ? 'AUTO' : 'FIXED',
			counterAxisSizingMode: counterHug ? 'AUTO' : 'FIXED',
			fills: this.fills(element),
			strokes: this.strokes(style),
			cornerRadius: this.cornerRadius(element),
			clipsContent: style.clips
		});
		if (bindings !== undefined || layoutBindings !== undefined) {
			node.boundVariables = { ...bindings, ...layoutBindings };
		}
		this.nodes.push(node);
		const info: ParentInfo = {
			id,
			box: element.box,
			layout: layout.layoutMode,
			hugsWidth: horizontal === 'HUG',
			hugsHeight: vertical === 'HUG',
			counterAlign: layout.counterAxisAlignItems
		};
		if (element.text !== undefined) {
			this.textInBox(element, element.text, info);
			return;
		}
		const keys = rebalancedKeys(children.length);
		children.forEach((child, position) => {
			const childBox = boxOf(child);
			const childTransform = translationMatrix(
				round(childBox.x - element.box.x),
				round(childBox.y - element.box.y)
			);
			if (child.kind === 'text') this.textLeaf(child, info, keys[position], childTransform);
			else this.element(child, info, keys[position], childTransform);
		});
	}

	private padding(
		style: StyleSnapshot
	): Pick<AutoLayout, 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'> {
		return {
			paddingTop: round(style.padding.top + style.borderWidth.top),
			paddingRight: round(style.padding.right + style.borderWidth.right),
			paddingBottom: round(style.padding.bottom + style.borderWidth.bottom),
			paddingLeft: round(style.padding.left + style.borderWidth.left)
		};
	}

	private noLayout(element: ElementSnapshot): AutoLayout {
		return {
			layoutMode: 'NONE',
			layoutWrap: 'NO_WRAP',
			itemSpacing: 0,
			counterAxisSpacing: null,
			primaryAxisAlignItems: 'MIN',
			counterAxisAlignItems: 'MIN',
			...this.padding(element.style),
			children: element.children
		};
	}

	private flexLayout(element: ElementSnapshot): AutoLayout | null {
		const style = element.style;
		if (!isFlex(style)) return null;
		const vertical = style.flexDirection.startsWith('column');
		const inFlow = element.children.filter((child) => !isAbsolute(child));
		const absolute = element.children.filter(isAbsolute);
		if (style.flexDirection.endsWith('reverse')) inFlow.reverse();
		for (const child of inFlow) {
			if (child.kind === 'text') continue;
			const margin = child.style.margin;
			if (margin.top !== 0 || margin.right !== 0 || margin.bottom !== 0 || margin.left !== 0) {
				this.warn('margins on flex items are ignored; use gap on the container');
			}
			const self = ALIGN[child.style.alignSelf] ?? 'MIN';
			const container = ALIGN[style.alignItems] ?? 'MIN';
			const inherits = ['auto', 'normal', 'stretch'].includes(child.style.alignSelf);
			if (vertical && isPlainText(child)) continue;
			if (!inherits && self !== container) {
				this.warn('align-self is not supported; the container alignment applies');
			}
		}
		const justify = style.justifyContent;
		if (justify === 'space-around' || justify === 'space-evenly') {
			this.warn(`justify-content: ${justify} became space-between`);
		}
		let wrap: AutoLayout['layoutWrap'] = 'NO_WRAP';
		if (style.flexWrap !== 'nowrap' && !vertical) wrap = 'WRAP';
		let counterAxisSpacing: number | null = null;
		if (wrap === 'WRAP') counterAxisSpacing = round(style.rowGap);
		return {
			layoutMode: vertical ? 'VERTICAL' : 'HORIZONTAL',
			layoutWrap: wrap,
			itemSpacing: round(vertical ? style.rowGap : style.columnGap),
			counterAxisSpacing,
			primaryAxisAlignItems: JUSTIFY[justify] ?? 'MIN',
			counterAxisAlignItems: ALIGN[style.alignItems] ?? 'MIN',
			...this.padding(style),
			children: [...inFlow, ...absolute]
		};
	}

	/** A decorated element holding only text, like a button: auto layout around one text layer. */
	private textBoxLayout(element: ElementSnapshot): AutoLayout {
		let primary: AutoLayout['primaryAxisAlignItems'] = 'MIN';
		const align = element.style.textAlign;
		if (align === 'center') primary = 'CENTER';
		if (align === 'right' || align === 'end') primary = 'MAX';
		let counter: AutoLayout['counterAxisAlignItems'] = 'MIN';
		if (CENTERED_CONTROLS.has(element.tag)) counter = 'CENTER';
		return {
			...this.noLayout(element),
			layoutMode: 'HORIZONTAL',
			primaryAxisAlignItems: primary,
			counterAxisAlignItems: counter,
			children: []
		};
	}

	/** Block flow as vertical auto layout, when the children allow it. */
	private stackLayout(element: ElementSnapshot): AutoLayout {
		const none = this.noLayout(element);
		const style = element.style;
		if (style.display === 'grid' || style.display === 'inline-grid') {
			this.warn('CSS grid is kept as fixed positions; use flex for editable layout');
			return none;
		}
		const inFlow = element.children.filter((child) => !isAbsolute(child));
		const absolute = element.children.filter(isAbsolute);
		if (inFlow.length === 0) return none;
		const boxes = inFlow.map(boxOf);
		for (let position = 1; position < boxes.length; position += 1) {
			if (boxes[position].y < bottom(boxes[position - 1]) - EVEN) return none;
		}
		const gaps = boxes.slice(1).map((box, position) => box.y - bottom(boxes[position]));
		if (!allNear(gaps)) {
			this.warn('block children with uneven spacing keep fixed positions; use flex with gap');
			return none;
		}
		const lefts = boxes.map((box) => box.x - element.box.x);
		const rights = boxes.map((box) => right(element.box) - right(box));
		const fills = inFlow.map((child) => child.kind === 'element' && child.sizing.width === 'fill');
		const sized = lefts.filter((_, position) => !fills[position]);
		const sizedRights = rights.filter((_, position) => !fills[position]);
		const filledLefts = lefts.filter((_, position) => fills[position]);
		const filledRights = rights.filter((_, position) => fills[position]);
		const css = this.padding(style);
		let primary: AutoLayout['counterAxisAlignItems'] | null = null;
		let paddingLeft = css.paddingLeft;
		let paddingRight = css.paddingRight;
		if (filledLefts.length > 0) {
			if (!allNear(filledLefts) || !allNear(filledRights)) return none;
			paddingLeft = filledLefts[0];
			paddingRight = filledRights[0];
		}
		if (
			sized.length === 0 ||
			(allNear(sized) && (filledLefts.length === 0 || near(sized[0], paddingLeft)))
		) {
			primary = 'MIN';
			if (sized.length > 0) paddingLeft = sized[0];
		} else if (sized.every((left, position) => near(left, sizedRights[position]))) {
			primary = 'CENTER';
		} else if (
			allNear(sizedRights) &&
			(filledRights.length === 0 || near(sizedRights[0], paddingRight))
		) {
			primary = 'MAX';
			paddingRight = sizedRights[0];
		}
		if (primary === null) {
			this.warn('block children with mixed alignment keep fixed positions; use flex');
			return none;
		}
		let itemSpacing = 0;
		if (gaps.length > 0) itemSpacing = round(Math.max(0, gaps[0]));
		return {
			...none,
			layoutMode: 'VERTICAL',
			itemSpacing,
			counterAxisAlignItems: primary,
			paddingTop: round(boxes[0].y - element.box.y),
			paddingBottom: round(bottom(element.box) - bottom(boxes[boxes.length - 1])),
			paddingLeft: round(paddingLeft),
			paddingRight: round(paddingRight),
			children: [...inFlow, ...absolute]
		};
	}

	// ---------- text ----------

	private textElement(
		element: ElementSnapshot,
		text: TextSnapshot,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3
	): void {
		const placement = this.placement(element, parent, index, transform, true);
		let autoResize: TextNode['textAutoResize'] = 'NONE';
		if (element.sizing.height === 'hug') autoResize = 'HEIGHT';
		if (element.sizing.width === 'hug' && text.lines <= 1) autoResize = 'WIDTH_AND_HEIGHT';
		if (autoResize === 'WIDTH_AND_HEIGHT') placement.layoutSizingHorizontal = 'HUG';
		else if (placement.layoutSizingHorizontal === 'HUG') placement.layoutSizingHorizontal = 'FIXED';
		if (autoResize !== 'NONE') placement.layoutSizingVertical = 'HUG';
		let textAlign = element.style.textAlign;
		const selfAlign = ALIGN[element.style.alignSelf];
		if (
			parent.layout === 'VERTICAL' &&
			selfAlign !== undefined &&
			selfAlign !== parent.counterAlign
		) {
			// Auto layout cannot align one child differently; a full-width text box aligned inside can.
			placement.layoutSizingHorizontal = 'FILL';
			autoResize = 'HEIGHT';
			if (selfAlign === 'CENTER') textAlign = 'center';
			if (selfAlign === 'MAX') textAlign = 'right';
		}
		this.nodes.push(
			createNode('TEXT', {
				id: this.idFor(element),
				name: this.nameOf(element, 'Text'),
				...placement,
				...this.appearance(element, false),
				...this.textContent(text, textAlign),
				textAutoResize: autoResize
			})
		);
	}

	/** The text layer inside a decorated element. */
	private textInBox(element: ElementSnapshot, text: TextSnapshot, frame: ParentInfo): void {
		const fill = !frame.hugsWidth && text.lines > 1;
		let horizontal: Sizing = 'HUG';
		let autoResize: TextNode['textAutoResize'] = 'WIDTH_AND_HEIGHT';
		if (fill) {
			horizontal = 'FILL';
			autoResize = 'HEIGHT';
		}
		this.nodes.push(
			createNode('TEXT', {
				id: this.generateId(),
				name: plainTextOf(text).slice(0, 40) || 'Text',
				parentId: frame.id,
				index: rebalancedKeys(1)[0],
				transform: translationMatrix(
					round(text.box.x - element.box.x),
					round(text.box.y - element.box.y)
				),
				width: round(text.box.width),
				height: round(text.box.height),
				layoutSizingHorizontal: horizontal,
				layoutSizingVertical: 'HUG',
				...this.textContent(text, element.style.textAlign),
				textAutoResize: autoResize
			})
		);
	}

	private textLeaf(
		leaf: TextLeafSnapshot,
		parent: ParentInfo,
		index: string,
		transform: Matrix2x3
	): void {
		const text = leaf.text;
		let autoResize: TextNode['textAutoResize'] = 'HEIGHT';
		let horizontal: Sizing = 'FIXED';
		if (text.lines <= 1) {
			autoResize = 'WIDTH_AND_HEIGHT';
			horizontal = 'HUG';
		}
		this.nodes.push(
			createNode('TEXT', {
				id: this.generateId(),
				name: plainTextOf(text).slice(0, 40) || 'Text',
				parentId: parent.id,
				index,
				transform,
				width: round(text.box.width),
				height: round(text.box.height),
				layoutSizingHorizontal: horizontal,
				layoutSizingVertical: 'HUG',
				...this.textContent(text, leaf.textAlign),
				textAutoResize: autoResize
			})
		);
	}

	private textContent(
		text: TextSnapshot,
		textAlign: string
	): { paragraphs: Paragraph[]; defaultStyle: TextStyle; fills: Paint[] } {
		const firstRun = text.paragraphs.flat()[0];
		if (firstRun === undefined) {
			return { paragraphs: normalizeParagraphs([]), defaultStyle: defaultTextStyle(), fills: [] };
		}
		const defaultStyle = this.textStyle(firstRun);
		const align = TEXT_ALIGN[textAlign] ?? 'LEFT';
		const paragraphs = text.paragraphs.map((runs) => ({
			...emptyParagraph(),
			align,
			runs: runs.map((run): TextRun => ({
				text: run.text,
				style: this.styleDelta(defaultStyle, run)
			}))
		}));
		return {
			paragraphs: normalizeParagraphs(paragraphs),
			defaultStyle,
			fills: structuredClone(defaultStyle.fills)
		};
	}

	private styleDelta(defaultStyle: TextStyle, run: RunSnapshot): Partial<TextStyle> {
		const style = this.textStyle(run);
		const delta: Partial<TextStyle> = {};
		for (const [key, value] of Object.entries(style)) {
			if (deepEqual(value, Reflect.get(defaultStyle, key))) continue;
			Object.assign(delta, { [key]: value });
		}
		return delta;
	}

	private textStyle(run: RunSnapshot): TextStyle {
		const font: FontSnapshot = run.font;
		this.checkFamily(font.family);
		const fill = solid(font.color);
		if (run.colorVariable !== undefined) {
			const variableId = this.variableId(run.colorVariable);
			if (variableId !== undefined && fill.type === 'SOLID')
				fill.boundVariables = { color: alias(variableId) };
		}
		let lineHeight: TextStyle['lineHeight'] = { unit: 'AUTO' };
		if (font.lineHeight !== null) lineHeight = { value: round(font.lineHeight), unit: 'PIXELS' };
		return {
			...defaultTextStyle(),
			fontName: { family: font.family, style: styleName(font.weight, font.italic) },
			fontWeight: font.weight,
			fontSize: round(font.size),
			letterSpacing: { value: round(font.letterSpacing), unit: 'PIXELS' },
			lineHeight,
			textCase: TEXT_CASE[font.transform] ?? 'ORIGINAL',
			textDecoration: DECORATION[font.decoration] ?? 'NONE',
			fills: [fill]
		};
	}

	private checkFamily(family: string): void {
		const available = this.options.availableFamilies;
		if (available === undefined || available.has(family)) return;
		if (this.reportedFamilies.has(family)) return;
		this.reportedFamilies.add(family);
		this.warn(`font "${family}" is not available; it is drawn with a fallback`);
	}

	// ---------- paints, strokes, effects ----------

	private fills(element: ElementSnapshot): Paint[] {
		const style = element.style;
		const paints: Paint[] = [];
		if (style.background !== null && style.background.a > 0) {
			const paint = solid(style.background);
			const variableId = this.boundVariableId(element, 'background-color');
			if (variableId !== undefined && paint.type === 'SOLID')
				paint.boundVariables = { color: alias(variableId) };
			paints.push(paint);
		}
		for (const layer of [...style.backgroundLayers].reverse()) {
			const paint = this.layerPaint(layer, element.box);
			if (paint !== null) paints.push(paint);
		}
		return paints;
	}

	private layerPaint(layer: BackgroundLayer, box: Rect): Paint | null {
		if (layer.kind === 'image') {
			this.warn('background images are not imported yet: drawn as a grey placeholder');
			return solid(PLACEHOLDER_IMAGE);
		}
		if (box.width <= 0 || box.height <= 0) return null;
		if (layer.kind === 'radial') {
			this.warn('radial-gradient is approximated as an ellipse filling the box');
			const half = Math.SQRT1_2;
			return this.gradient(
				'GRADIENT_RADIAL',
				radialMatrix(0.5, 0.5, half),
				layer.stops,
				Math.hypot(box.width, box.height) * half
			);
		}
		let degrees: number;
		if (layer.direction.kind === 'angle') degrees = layer.direction.degrees;
		else
			degrees =
				(Math.atan2(layer.direction.x * box.height, -layer.direction.y * box.width) * 180) /
				Math.PI;
		const radians = (degrees * Math.PI) / 180;
		const directionX = Math.sin(radians);
		const directionY = -Math.cos(radians);
		const length = Math.abs(box.width * directionX) + Math.abs(box.height * directionY);
		const centerX = box.width / 2;
		const centerY = box.height / 2;
		const start: [number, number] = [
			(centerX - (directionX * length) / 2) / box.width,
			(centerY - (directionY * length) / 2) / box.height
		];
		const end: [number, number] = [
			(centerX + (directionX * length) / 2) / box.width,
			(centerY + (directionY * length) / 2) / box.height
		];
		return this.gradient('GRADIENT_LINEAR', linearMatrix(start, end), layer.stops, length);
	}

	private gradient(
		type: GradientPaint['type'],
		gradientToBox: Matrix2x3,
		stops: readonly ColorStopSnapshot[],
		length: number
	): Paint | null {
		const inverse = invertMatrix(gradientToBox);
		if (inverse === null) return null;
		return {
			type,
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL',
			gradientTransform: inverse,
			gradientStops: spreadStops(stops, length)
		};
	}

	private strokes(style: StyleSnapshot): Stroke[] {
		if (!hasBorder(style) || style.borderColor === null) return [];
		const widths = style.borderWidth;
		let weight: Stroke['weight'] = { ...widths };
		if (widths.top === widths.right && widths.top === widths.bottom && widths.top === widths.left) {
			weight = widths.top;
		}
		const width = Math.max(widths.top, widths.right, widths.bottom, widths.left);
		let dashPattern: number[] = [];
		let cap: Stroke['cap'] = 'NONE';
		if (style.borderStyle === 'dashed') dashPattern = [width * 3, width * 2];
		if (style.borderStyle === 'dotted') {
			dashPattern = [0, width * 2];
			cap = 'ROUND';
		}
		return [
			{
				paints: [solid(style.borderColor)],
				weight,
				align: 'INSIDE',
				cap,
				join: 'MITER',
				miterLimit: 4,
				dashPattern
			}
		];
	}

	private cornerRadius(element: ElementSnapshot): number | [number, number, number, number] {
		const [topLeft, topRight, bottomRight, bottomLeft] = element.style.radii;
		const radii: [number, number, number, number] = [
			round(topLeft),
			round(topRight),
			round(bottomRight),
			round(bottomLeft)
		];
		if (radii.every((radius) => radius === radii[0])) return radii[0];
		return radii;
	}

	private effects(style: StyleSnapshot): Effect[] {
		const effects: Effect[] = style.shadows.map((shadow) => ({
			type: shadow.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
			visible: true,
			color: shadow.color,
			offset: { x: shadow.x, y: shadow.y },
			radius: shadow.blur,
			spread: shadow.spread,
			blendMode: 'NORMAL',
			showShadowBehindNode: false
		}));
		if (style.blur > 0) effects.push({ type: 'LAYER_BLUR', visible: true, radius: style.blur });
		if (style.backdropBlur > 0) {
			effects.push({ type: 'BACKGROUND_BLUR', visible: true, radius: style.backdropBlur });
		}
		return effects;
	}

	// ---------- variables ----------

	private variableId(cssName: string): string | undefined {
		const variables = this.options.variables;
		if (variables === undefined) return undefined;
		const id = variables[cssName];
		if (id === undefined) this.warn(`var(${cssName}) is not a variable of this file`);
		return id;
	}

	private boundVariableId(element: ElementSnapshot, property: string): string | undefined {
		const cssName = element.variables[property];
		if (cssName === undefined) return undefined;
		return this.variableId(cssName);
	}

	private nodeBindings(
		element: ElementSnapshot,
		properties: readonly string[]
	): BoundVariables | undefined {
		const bindings: BoundVariables = {};
		for (const property of properties) {
			const id = this.boundVariableId(element, property);
			if (id !== undefined) bindings[property] = alias(id);
		}
		if (Object.keys(bindings).length === 0) return undefined;
		return bindings;
	}

	private layoutBindings(element: ElementSnapshot, mode: LayoutMode): BoundVariables | undefined {
		const bindings: BoundVariables = {};
		const bind = (nodeProperty: string, cssProperty: string): void => {
			const id = this.boundVariableId(element, cssProperty);
			if (id !== undefined) bindings[nodeProperty] = alias(id);
		};
		if (mode !== 'NONE') {
			bind('itemSpacing', mode === 'VERTICAL' ? 'row-gap' : 'column-gap');
			bind('paddingTop', 'padding-top');
			bind('paddingRight', 'padding-right');
			bind('paddingBottom', 'padding-bottom');
			bind('paddingLeft', 'padding-left');
		}
		const corners = [
			'border-top-left-radius',
			'border-top-right-radius',
			'border-bottom-right-radius',
			'border-bottom-left-radius'
		];
		const cornerVariables = corners.map((corner) => element.variables[corner]);
		if (
			cornerVariables[0] !== undefined &&
			cornerVariables.every((name) => name === cornerVariables[0])
		) {
			bind('cornerRadius', corners[0]);
		}
		if (Object.keys(bindings).length === 0) return undefined;
		return bindings;
	}
}

/** CSS stop positions to 0..1, spreading the ones CSS leaves open evenly between their neighbours. */
export function spreadStops(
	stops: readonly ColorStopSnapshot[],
	length: number
): GradientPaint['gradientStops'] {
	const positions: (number | null)[] = stops.map((stop) => {
		if (stop.position === null) return null;
		if (stop.position.unit === '%') return stop.position.value / 100;
		if (length <= 0) return 0;
		return stop.position.value / length;
	});
	if (positions[0] === null) positions[0] = 0;
	if (positions[positions.length - 1] === null) positions[positions.length - 1] = 1;
	let previous = 0;
	for (let position = 0; position < positions.length; position += 1) {
		const value = positions[position];
		if (value === null) continue;
		const clamped = Math.max(value, previous);
		positions[position] = clamped;
		previous = clamped;
	}
	let lastKnown = 0;
	for (let position = 1; position < positions.length; position += 1) {
		if (positions[position] === null) continue;
		const gap = position - lastKnown;
		const from = positions[lastKnown] ?? 0;
		const to = positions[position] ?? 1;
		for (let step = 1; step < gap; step += 1)
			positions[lastKnown + step] = from + ((to - from) * step) / gap;
		lastKnown = position;
	}
	return stops.map((stop, position) => ({
		color: stop.color,
		position: Math.min(1, Math.max(0, positions[position] ?? 0))
	}));
}

export function convertSnapshot(snapshot: HtmlSnapshot, options: ConvertOptions): ConvertResult {
	const converter = new Converter(options);
	for (const warning of snapshot.warnings) converter.warn(warning);
	const first = snapshot.roots[0];
	const keys = rebalancedKeys(snapshot.roots.length);
	const rootIds: NodeId[] = [];
	const page: ParentInfo = {
		id: options.parentId,
		box: { x: 0, y: 0, width: 0, height: 0 },
		layout: 'NONE',
		hugsWidth: false,
		hugsHeight: false,
		counterAlign: 'MIN'
	};
	snapshot.roots.forEach((root, position) => {
		const transform = translationMatrix(
			round(options.origin.x + root.box.x - first.box.x),
			round(options.origin.y + root.box.y - first.box.y)
		);
		const before = converter.nodes.length;
		converter.element(root, page, keys[position], transform);
		const made = converter.nodes[before];
		if (made !== undefined) rootIds.push(made.id);
	});
	return {
		nodes: converter.nodes,
		rootIds,
		idsByDataId: converter.idsByDataId,
		warnings: converter.warnings
	};
}
