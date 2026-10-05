// Measures HTML in a sandboxed, offscreen iframe and returns what the browser computed as a plain
// snapshot (see snapshot.ts). The iframe runs no scripts and loads nothing from the network (a
// CSP meta tag allows only inline styles and blob: fonts), so model-written HTML cannot reach out.
//
// Fonts are made to match what the canvas will draw: every element's font stack is resolved to a
// family the document has (or the default family), written back as an inline style, and that
// family's faces are loaded into the iframe from the fonts the caller provides. Text therefore
// wraps here the way it will wrap on the canvas.
//
// Sizing is probed rather than guessed: an element hugs its content on an axis if setting that
// size to `fit-content` leaves it unchanged, and fills its parent if setting it to `auto` leaves
// it unchanged while it spans the parent's content box.

import type { Rect, RGBA } from '../../document';
import {
	blurRadius,
	parseBackgroundImage,
	parseRgbFunction,
	parseShadows,
	pixelsOrZero,
	splitTopLevel,
	variableReference,
	type ColorParser
} from './cssValues';
import type {
	AxisSizing,
	ElementSnapshot,
	FontSnapshot,
	HtmlSnapshot,
	NodeSnapshot,
	RunSnapshot,
	Sides,
	StyleSnapshot,
	TextSnapshot
} from './snapshot';

export interface FontFaceSource {
	weight: number;
	italic: boolean;
	bytes: ArrayBuffer;
}

export interface FontSource {
	/** Families the document can draw. */
	families(): readonly string[];
	faces(family: string): Promise<FontFaceSource[]>;
}

export interface LayoutOptions {
	/** Width of the page the HTML is laid out in; roots without a width fill it. */
	viewportWidth: number;
	viewportHeight: number;
	/** Used for text whose font stack names nothing the document has. */
	defaultFamily: string;
	monospaceFamily?: string;
	fonts?: FontSource;
	/** Declared on `:root`, so `var(--name)` resolves: `{ '--surface': '#ffffff' }`. */
	cssVariables?: Readonly<Record<string, string>>;
}

const SKIPPED_TAGS = new Set([
	'script',
	'style',
	'link',
	'meta',
	'title',
	'template',
	'noscript',
	'head',
	'base'
]);
const LEAF_TAGS = new Set([
	'img',
	'input',
	'textarea',
	'select',
	'video',
	'canvas',
	'iframe',
	'hr'
]);
const KEPT_ATTRIBUTES = [
	'data-id',
	'data-name',
	'data-component',
	'aria-label',
	'alt',
	'id',
	'class',
	'src'
];
const GENERIC_FAMILIES = new Set([
	'serif',
	'sans-serif',
	'system-ui',
	'ui-sans-serif',
	'ui-serif',
	'ui-rounded',
	'-apple-system',
	'blinkmacsystemfont',
	'cursive',
	'fantasy'
]);
const MONOSPACE_FAMILIES = new Set(['monospace', 'ui-monospace']);
const LINE_TOLERANCE = 2;
const SIZE_TOLERANCE = 0.5;

/** Shorthand to the longhands a `var()` written on it applies to. */
const VARIABLE_PROPERTIES: Record<string, string[]> = {
	'background-color': ['background-color', 'background'],
	color: ['color'],
	'row-gap': ['row-gap', 'gap'],
	'column-gap': ['column-gap', 'gap'],
	'padding-top': ['padding-top', 'padding'],
	'padding-right': ['padding-right', 'padding'],
	'padding-bottom': ['padding-bottom', 'padding'],
	'padding-left': ['padding-left', 'padding'],
	'border-top-left-radius': ['border-top-left-radius', 'border-radius'],
	'border-top-right-radius': ['border-top-right-radius', 'border-radius'],
	'border-bottom-right-radius': ['border-bottom-right-radius', 'border-radius'],
	'border-bottom-left-radius': ['border-bottom-left-radius', 'border-radius'],
	width: ['width'],
	height: ['height'],
	opacity: ['opacity'],
	'font-size': ['font-size', 'font']
};

// The iframe is another realm, so `instanceof HTMLElement` is false for its nodes: test shapes.
function isElement(node: Node): node is Element {
	return node.nodeType === Node.ELEMENT_NODE;
}

function isText(node: Node): node is Text {
	return node.nodeType === Node.TEXT_NODE;
}

function isStyled(element: Element): element is HTMLElement | SVGElement {
	return 'style' in element;
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
	return 'selectorText' in rule;
}

function isMediaRule(rule: CSSRule): rule is CSSMediaRule {
	return 'conditionText' in rule && 'media' in rule;
}

function isField(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
	return 'value' in element && 'placeholder' in element;
}

// ---------- colours ----------

function canvasColorParser(): ColorParser {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	const cache = new Map<string, RGBA | null>();
	return (value) => {
		const fast = parseRgbFunction(value);
		if (fast !== null) return fast;
		const cached = cache.get(value);
		if (cached !== undefined) return cached;
		let parsed: RGBA | null = null;
		if (context !== null && CSS.supports('color', value)) {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = value;
			context.fillRect(0, 0, 1, 1);
			const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
			parsed = { r: red / 255, g: green / 255, b: blue / 255, a: alpha / 255 };
		}
		cache.set(value, parsed);
		return parsed;
	};
}

// ---------- the iframe ----------

function documentSource(html: string, options: LayoutOptions): string {
	const variables = Object.entries(options.cssVariables ?? {})
		.map(([name, value]) => `${name}: ${value};`)
		.join(' ');
	const policy =
		"default-src 'none'; style-src 'unsafe-inline'; font-src blob: data:; img-src blob: data:";
	return [
		'<!doctype html><html><head><meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${policy}">`,
		'<style>',
		`:root { ${variables} }`,
		'*, *::before, *::after { box-sizing: border-box; }',
		`html, body { margin: 0; padding: 0; }`,
		`body { width: ${options.viewportWidth}px; font-family: "${options.defaultFamily}"; font-size: 16px; color: #000; }`,
		'</style></head><body>',
		html,
		'</body></html>'
	].join('');
}

async function openFrame(html: string, options: LayoutOptions): Promise<HTMLIFrameElement> {
	const frame = document.createElement('iframe');
	frame.setAttribute('sandbox', 'allow-same-origin');
	frame.setAttribute('aria-hidden', 'true');
	frame.tabIndex = -1;
	Object.assign(frame.style, {
		position: 'fixed',
		left: '-100000px',
		top: '0',
		width: `${options.viewportWidth}px`,
		height: `${options.viewportHeight}px`,
		border: '0',
		visibility: 'hidden',
		pointerEvents: 'none'
	});
	frame.srcdoc = documentSource(html, options);
	const loaded = new Promise<void>((resolve) => {
		frame.addEventListener('load', () => resolve(), { once: true });
	});
	document.body.append(frame);
	await loaded;
	return frame;
}

// ---------- fonts ----------

function unquote(family: string): string {
	return family.trim().replace(/^["']|["']$/g, '');
}

class FontResolver {
	private readonly available: Map<string, string>;
	readonly used = new Set<string>();
	readonly missing = new Set<string>();

	constructor(private readonly options: LayoutOptions) {
		const families = options.fonts?.families() ?? [options.defaultFamily];
		this.available = new Map(families.map((family) => [family.toLowerCase(), family]));
	}

	/** The family the canvas will draw for a CSS font stack. */
	resolve(stack: string): string {
		for (const entry of splitTopLevel(stack, ',')) {
			const family = unquote(entry);
			const lower = family.toLowerCase();
			const known = this.available.get(lower);
			if (known !== undefined) return this.use(known);
			if (MONOSPACE_FAMILIES.has(lower)) return this.use(this.monospace());
			if (GENERIC_FAMILIES.has(lower)) return this.use(this.options.defaultFamily);
			this.missing.add(family);
		}
		return this.use(this.options.defaultFamily);
	}

	private monospace(): string {
		const wanted = this.options.monospaceFamily;
		if (wanted !== undefined && this.available.has(wanted.toLowerCase())) return wanted;
		return this.options.defaultFamily;
	}

	private use(family: string): string {
		this.used.add(family);
		return family;
	}
}

/** Every element's font stack replaced by the one family the canvas will use for it. */
function pinFonts(root: HTMLElement, view: Window, resolver: FontResolver): void {
	const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
	const families = elements.map((element) =>
		resolver.resolve(view.getComputedStyle(element).fontFamily)
	);
	elements.forEach((element, position) => {
		if (!isStyled(element)) return;
		element.style.setProperty('font-family', `"${families[position]}"`, 'important');
	});
}

async function loadFonts(
	frame: HTMLIFrameElement,
	resolver: FontResolver,
	options: LayoutOptions
): Promise<() => void> {
	const source = options.fonts;
	const frameDocument = frame.contentDocument;
	if (source === undefined || frameDocument === null) return () => {};
	const urls: string[] = [];
	const rules: string[] = [];
	const loads: string[] = [];
	for (const family of resolver.used) {
		const faces = await source.faces(family).catch(() => []);
		for (const face of faces) {
			const url = URL.createObjectURL(new Blob([face.bytes]));
			urls.push(url);
			const slant = face.italic ? 'italic' : 'normal';
			rules.push(
				`@font-face { font-family: "${family}"; src: url(${url}); font-weight: ${face.weight}; font-style: ${slant}; }`
			);
			loads.push(`${slant} ${face.weight} 16px "${family}"`);
		}
	}
	const style = frameDocument.createElement('style');
	style.textContent = rules.join('\n');
	frameDocument.head.append(style);
	await Promise.all(loads.map((font) => frameDocument.fonts.load(font).catch(() => [])));
	await frameDocument.fonts.ready;
	return () => urls.forEach((url) => URL.revokeObjectURL(url));
}

// ---------- the walk ----------

class Measurer {
	readonly warnings: string[] = [];
	private readonly rules: CSSStyleRule[];
	private readonly origin: { x: number; y: number };

	constructor(
		private readonly view: Window,
		private readonly frameDocument: Document,
		private readonly parseColor: ColorParser
	) {
		this.rules = this.collectRules();
		this.origin = { x: 0, y: 0 };
	}

	warn(message: string): void {
		if (!this.warnings.includes(message)) this.warnings.push(message);
	}

	private collectRules(): CSSStyleRule[] {
		const rules: CSSStyleRule[] = [];
		const visit = (list: CSSRuleList): void => {
			for (const rule of Array.from(list)) {
				if (isStyleRule(rule)) rules.push(rule);
				else if (isMediaRule(rule) && this.view.matchMedia(rule.conditionText).matches) {
					visit(rule.cssRules);
				}
			}
		};
		for (const sheet of Array.from(this.frameDocument.styleSheets)) visit(sheet.cssRules);
		return rules;
	}

	private rect(element: Element): Rect {
		const box = element.getBoundingClientRect();
		return {
			x: box.x - this.origin.x,
			y: box.y - this.origin.y,
			width: box.width,
			height: box.height
		};
	}

	/** The body's children; the body itself when the HTML is a whole document. */
	roots(body: HTMLElement, wholeDocument: boolean): ElementSnapshot[] {
		const root = body.parentElement;
		if (wholeDocument && root !== null) {
			const snapshot = this.element(body, root);
			if (snapshot === null) return [];
			snapshot.tag = 'page';
			return [snapshot];
		}
		const roots: ElementSnapshot[] = [];
		for (const child of Array.from(body.children)) {
			const snapshot = this.element(child, body);
			if (snapshot !== null) roots.push(snapshot);
		}
		return roots;
	}

	private element(element: Element, parent: Element): ElementSnapshot | null {
		const tag = element.tagName.toLowerCase();
		if (SKIPPED_TAGS.has(tag)) {
			if (tag === 'script')
				this.warn('scripts do not run: write plain HTML and CSS (no Tailwind CDN, no JS)');
			if (tag === 'link')
				this.warn('external stylesheets are not loaded: put CSS in a <style> element');
			return null;
		}
		const computed = this.view.getComputedStyle(element);
		if (computed.display === 'none') return null;
		const box = this.rect(element);
		const snapshot: ElementSnapshot = {
			kind: 'element',
			tag,
			attributes: this.attributes(element),
			box,
			style: this.style(computed, box),
			sizing: this.sizing(element, parent, box),
			variables: this.variables(element),
			children: []
		};
		if (computed.transform !== 'none') this.warn('CSS transforms are ignored (rotation included)');
		if (tag === 'svg') {
			snapshot.svg = this.svgMarkup(element, this.contentBox(element));
			return snapshot;
		}
		if (tag === 'input' || tag === 'textarea') {
			const text = this.fieldText(element, computed, box);
			if (text !== undefined) snapshot.text = text;
			return snapshot;
		}
		if (LEAF_TAGS.has(tag)) return snapshot;
		if (this.isInlineContent(element)) {
			snapshot.text = this.text(element, element);
			return snapshot;
		}
		snapshot.children = this.children(element, computed);
		return snapshot;
	}

	private children(element: Element, computed: CSSStyleDeclaration): NodeSnapshot[] {
		const children: NodeSnapshot[] = [];
		for (const child of Array.from(element.childNodes)) {
			if (isElement(child)) {
				const snapshot = this.element(child, element);
				if (snapshot !== null) children.push(snapshot);
				continue;
			}
			if (!isText(child) || (child.textContent ?? '').trim() === '') continue;
			const text = this.text(child, element);
			if (text.paragraphs.length === 0) continue;
			children.push({ kind: 'text', text, textAlign: computed.textAlign });
		}
		return children;
	}

	private attributes(element: Element): Record<string, string> {
		const attributes: Record<string, string> = {};
		for (const name of KEPT_ATTRIBUTES) {
			const value = element.getAttribute(name);
			if (value !== null) attributes[name] = value;
		}
		return attributes;
	}

	// ---------- style ----------

	private sides(computed: CSSStyleDeclaration, prefix: string, suffix = ''): Sides {
		const read = (side: string): number =>
			pixelsOrZero(computed.getPropertyValue(`${prefix}-${side}${suffix}`));
		return { top: read('top'), right: read('right'), bottom: read('bottom'), left: read('left') };
	}

	private radius(value: string, box: Rect): number {
		const first = value.trim().split(/\s+/)[0];
		if (first.endsWith('%'))
			return (Number(first.slice(0, -1)) / 100) * Math.min(box.width, box.height);
		return pixelsOrZero(first);
	}

	private border(computed: CSSStyleDeclaration): { style: string; color: RGBA | null } {
		for (const side of ['top', 'right', 'bottom', 'left']) {
			const style = computed.getPropertyValue(`border-${side}-style`);
			if (style === 'none' || style === 'hidden') continue;
			if (pixelsOrZero(computed.getPropertyValue(`border-${side}-width`)) === 0) continue;
			return { style, color: this.parseColor(computed.getPropertyValue(`border-${side}-color`)) };
		}
		return { style: 'none', color: null };
	}

	private style(computed: CSSStyleDeclaration, box: Rect): StyleSnapshot {
		const background = parseBackgroundImage(computed.backgroundImage, this.parseColor);
		for (const warning of background.warnings) this.warn(warning);
		const border = this.border(computed);
		const clipping = ['hidden', 'clip', 'scroll', 'auto'];
		if (computed.textShadow !== 'none') this.warn('text-shadow is ignored');
		return {
			display: computed.display,
			position: computed.position,
			visible: computed.visibility === 'visible',
			opacity: Number(computed.opacity),
			blendMode: computed.mixBlendMode,
			clips: clipping.includes(computed.overflowX) || clipping.includes(computed.overflowY),
			flexDirection: computed.flexDirection,
			flexWrap: computed.flexWrap,
			flexGrow: Number(computed.flexGrow),
			justifyContent: computed.justifyContent,
			alignItems: computed.alignItems,
			alignSelf: computed.alignSelf,
			rowGap: pixelsOrZero(computed.rowGap),
			columnGap: pixelsOrZero(computed.columnGap),
			padding: this.sides(computed, 'padding'),
			margin: this.sides(computed, 'margin'),
			borderWidth: this.sides(computed, 'border', '-width'),
			borderStyle: border.style,
			borderColor: border.color,
			radii: [
				this.radius(computed.borderTopLeftRadius, box),
				this.radius(computed.borderTopRightRadius, box),
				this.radius(computed.borderBottomRightRadius, box),
				this.radius(computed.borderBottomLeftRadius, box)
			],
			background: this.parseColor(computed.backgroundColor),
			backgroundLayers: background.layers,
			shadows: parseShadows(computed.boxShadow, this.parseColor),
			blur: blurRadius(computed.filter),
			backdropBlur: blurRadius(computed.backdropFilter),
			minWidth: this.limit(computed.minWidth),
			maxWidth: this.limit(computed.maxWidth),
			minHeight: this.limit(computed.minHeight),
			maxHeight: this.limit(computed.maxHeight),
			textAlign: computed.textAlign,
			whiteSpace: computed.whiteSpace,
			font: this.font(computed)
		};
	}

	private limit(value: string): number | null {
		const parsed = pixelsOrZero(value);
		if (parsed <= 0) return null;
		return parsed;
	}

	private font(computed: CSSStyleDeclaration): FontSnapshot {
		const decorations = computed.textDecorationLine;
		let decoration: FontSnapshot['decoration'] = 'none';
		if (decorations.includes('underline')) decoration = 'underline';
		if (decorations.includes('line-through')) decoration = 'line-through';
		let transform: FontSnapshot['transform'] = 'none';
		const textTransform = computed.textTransform;
		if (
			textTransform === 'uppercase' ||
			textTransform === 'lowercase' ||
			textTransform === 'capitalize'
		) {
			transform = textTransform;
		}
		let lineHeight: number | null = null;
		if (computed.lineHeight !== 'normal') lineHeight = pixelsOrZero(computed.lineHeight);
		return {
			family: unquote(splitTopLevel(computed.fontFamily, ',')[0] ?? ''),
			weight: Number(computed.fontWeight),
			italic: computed.fontStyle === 'italic' || computed.fontStyle.startsWith('oblique'),
			size: pixelsOrZero(computed.fontSize),
			lineHeight,
			letterSpacing: pixelsOrZero(computed.letterSpacing),
			transform,
			decoration,
			color: this.parseColor(computed.color) ?? { r: 0, g: 0, b: 0, a: 1 }
		};
	}

	// ---------- sizing ----------

	private probe(
		element: Element,
		property: 'width' | 'height',
		value: string,
		before: Rect
	): boolean {
		if (!isStyled(element)) return true;
		const style = element.style;
		const previous = style.getPropertyValue(property);
		const priority = style.getPropertyPriority(property);
		style.setProperty(property, value, 'important');
		const after = element.getBoundingClientRect();
		style.setProperty(property, previous, priority);
		if (previous === '') style.removeProperty(property);
		return Math.abs(after[property] - before[property]) <= SIZE_TOLERANCE;
	}

	private contentBox(parent: Element): Rect {
		const box = this.rect(parent);
		const computed = this.view.getComputedStyle(parent);
		const padding = this.sides(computed, 'padding');
		const border = this.sides(computed, 'border', '-width');
		return {
			x: box.x + padding.left + border.left,
			y: box.y + padding.top + border.top,
			width: box.width - padding.left - padding.right - border.left - border.right,
			height: box.height - padding.top - padding.bottom - border.top - border.bottom
		};
	}

	private axisSizing(
		element: Element,
		axis: 'width' | 'height',
		box: Rect,
		parentContent: Rect
	): AxisSizing {
		if (this.probe(element, axis, 'fit-content', box)) return 'hug';
		const auto = this.probe(element, axis, 'auto', box);
		if (auto && Math.abs(box[axis] - parentContent[axis]) <= SIZE_TOLERANCE) return 'fill';
		return 'fixed';
	}

	private sizing(element: Element, parent: Element, box: Rect): ElementSnapshot['sizing'] {
		const parentContent = this.contentBox(parent);
		return {
			width: this.axisSizing(element, 'width', box, parentContent),
			height: this.axisSizing(element, 'height', box, parentContent)
		};
	}

	// ---------- variables ----------

	private variables(element: Element): Record<string, string> {
		const sources: CSSStyleDeclaration[] = this.rules
			.filter((rule) => {
				try {
					return element.matches(rule.selectorText);
				} catch {
					return false;
				}
			})
			.map((rule) => rule.style);
		if (isStyled(element)) sources.push(element.style);
		const found: Record<string, string> = {};
		for (const [longhand, candidates] of Object.entries(VARIABLE_PROPERTIES)) {
			for (const source of sources) {
				for (const property of candidates) {
					const reference = variableReference(source.getPropertyValue(property));
					if (reference !== null) found[longhand] = reference;
				}
			}
		}
		return found;
	}

	/** The variable the text colour of `element` comes from, looking up the inherited chain. */
	private colorVariable(element: Element | null): string | undefined {
		let current = element;
		while (current !== null && current !== this.frameDocument.documentElement) {
			const variables = this.variables(current);
			if (variables.color !== undefined) return variables.color;
			const own = this.view.getComputedStyle(current);
			if (current.parentElement !== null) {
				const inherited = this.view.getComputedStyle(current.parentElement);
				if (own.color !== inherited.color) return undefined;
			}
			current = current.parentElement;
		}
		return undefined;
	}

	// ---------- text ----------

	/** Holds text, and nothing but text and inline elements around text. */
	private isInlineContent(element: Element): boolean {
		if ((element.textContent ?? '').trim() === '') return false;
		return this.onlyInline(element);
	}

	private onlyInline(element: Element): boolean {
		for (const child of Array.from(element.children)) {
			const tag = child.tagName.toLowerCase();
			if (tag === 'br') continue;
			if (tag === 'svg' || LEAF_TAGS.has(tag) || SKIPPED_TAGS.has(tag)) return false;
			const display = this.view.getComputedStyle(child).display;
			if (display !== 'inline' && display !== 'contents') return false;
			if (!this.onlyInline(child)) return false;
		}
		return true;
	}

	private text(content: Node, element: Element): TextSnapshot {
		const paragraphs: RunSnapshot[][] = [[]];
		this.collectRuns(content, paragraphs);
		const range = this.frameDocument.createRange();
		range.selectNodeContents(content);
		const bounds = range.getBoundingClientRect();
		const tops: number[] = [];
		for (const line of Array.from(range.getClientRects())) {
			if (line.width === 0) continue;
			if (tops.every((top) => Math.abs(top - line.top) > LINE_TOLERANCE)) tops.push(line.top);
		}
		const box = {
			x: bounds.x - this.origin.x,
			y: bounds.y - this.origin.y,
			width: bounds.width,
			height: bounds.height
		};
		if (box.width === 0 && box.height === 0) {
			Object.assign(box, this.rect(element));
		}
		return { box, lines: Math.max(1, tops.length), paragraphs: tidyParagraphs(paragraphs) };
	}

	private collectRuns(node: Node, paragraphs: RunSnapshot[][]): void {
		if (isText(node)) {
			const parent = node.parentElement;
			if (parent === null) return;
			const computed = this.view.getComputedStyle(parent);
			const font = this.font(computed);
			const colorVariable = this.colorVariable(parent);
			const pieces = whiteSpaceText(node.data, computed.whiteSpace);
			pieces.forEach((piece, position) => {
				if (position > 0) paragraphs.push([]);
				if (piece === '') return;
				const run: RunSnapshot = { text: piece, font };
				if (colorVariable !== undefined) run.colorVariable = colorVariable;
				paragraphs[paragraphs.length - 1].push(run);
			});
			return;
		}
		if (!isElement(node)) return;
		if (node.tagName.toLowerCase() === 'br') {
			paragraphs.push([]);
			return;
		}
		for (const child of Array.from(node.childNodes)) this.collectRuns(child, paragraphs);
	}

	private fieldText(
		element: Element,
		computed: CSSStyleDeclaration,
		box: Rect
	): TextSnapshot | undefined {
		if (!isField(element)) return undefined;
		let value = element.value;
		let style = computed;
		if (value === '') {
			value = element.placeholder;
			style = this.view.getComputedStyle(element, '::placeholder');
		}
		if (value === '') return undefined;
		const padding = this.sides(computed, 'padding');
		const border = this.sides(computed, 'border', '-width');
		const font = this.font(style);
		const lineHeight = font.lineHeight ?? font.size * 1.2;
		const innerHeight = box.height - padding.top - padding.bottom - border.top - border.bottom;
		return {
			box: {
				x: box.x + padding.left + border.left,
				y: box.y + padding.top + border.top + Math.max(0, (innerHeight - lineHeight) / 2),
				width: box.width - padding.left - padding.right - border.left - border.right,
				height: lineHeight
			},
			lines: 1,
			paragraphs: [[{ text: value, font }]]
		};
	}

	// ---------- svg ----------

	/** The SVG at its laid out size, with CSS-applied paint written into attributes. */
	private svgMarkup(element: Element, box: Rect): string {
		const clone = element.cloneNode(true);
		if (!isElement(clone)) return element.outerHTML;
		const originals = [element, ...Array.from(element.querySelectorAll('*'))];
		const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
		originals.forEach((original, position) => {
			const copy = copies[position];
			const computed = this.view.getComputedStyle(original);
			for (const property of ['fill', 'stroke', 'stroke-width', 'opacity']) {
				const value = computed.getPropertyValue(property);
				if (value === '' || value.startsWith('url(')) continue;
				copy.setAttribute(property, value);
			}
		});
		clone.setAttribute('width', String(box.width));
		clone.setAttribute('height', String(box.height));
		clone.removeAttribute('style');
		clone.removeAttribute('class');
		return clone.outerHTML;
	}
}

/** Text of a text node as the browser renders it: one string per line it forces. */
function whiteSpaceText(data: string, whiteSpace: string): string[] {
	if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces') {
		return data.split('\n');
	}
	if (whiteSpace === 'pre-line') {
		return data.split('\n').map((line) => line.replace(/[ \t]+/g, ' '));
	}
	return [data.replace(/\s+/g, ' ')];
}

/** Collapses spaces across run boundaries and trims each paragraph, as the browser does. */
function tidyParagraphs(paragraphs: RunSnapshot[][]): RunSnapshot[][] {
	const tidied = paragraphs.map((runs) => {
		const result: RunSnapshot[] = [];
		let previousEndsWithSpace = true;
		for (const run of runs) {
			let text = run.text;
			if (previousEndsWithSpace) text = text.replace(/^ +/, '');
			if (text === '') continue;
			result.push({ ...run, text });
			previousEndsWithSpace = text.endsWith(' ');
		}
		const last = result[result.length - 1];
		if (last !== undefined) last.text = last.text.replace(/ +$/, '');
		return result.filter((run) => run.text !== '');
	});
	while (tidied.length > 1 && tidied[tidied.length - 1].length === 0) tidied.pop();
	while (tidied.length > 1 && tidied[0].length === 0) tidied.shift();
	return tidied.filter((runs, position) => runs.length > 0 || position < tidied.length);
}

/** Lays `html` out in a sandboxed iframe and snapshots what the browser computed. */
export async function measureHtml(html: string, options: LayoutOptions): Promise<HtmlSnapshot> {
	const frame = await openFrame(html, options);
	let releaseFonts = (): void => {};
	try {
		const view = frame.contentWindow;
		const frameDocument = frame.contentDocument;
		if (view === null || frameDocument === null) throw new Error('the layout frame did not open');
		const resolver = new FontResolver(options);
		pinFonts(frameDocument.body, view, resolver);
		releaseFonts = await loadFonts(frame, resolver, options);
		const measurer = new Measurer(view, frameDocument, canvasColorParser());
		const wholeDocument = /<(html|body)[\s>]/i.test(html);
		const roots = measurer.roots(frameDocument.body, wholeDocument);
		for (const family of resolver.missing) {
			measurer.warn(`font "${family}" is not available; used ${options.defaultFamily} instead`);
		}
		return { roots, warnings: measurer.warnings };
	} finally {
		releaseFonts();
		frame.remove();
	}
}
