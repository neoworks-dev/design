// What the browser computed for a piece of HTML, as plain data (no DOM). `layout.ts` produces it
// from a sandboxed iframe; `convert.ts` turns it into document nodes. Keeping the two apart means
// the conversion is pure and testable with hand-written snapshots, and only the measuring needs a
// real browser.
//
// Boxes are border boxes in CSS pixels, relative to the iframe's viewport. Colours are already
// resolved to sRGB floats 0..1 (oklch, hsl, named colours, `currentColor` included).

import type { Rect, RGBA } from '../../document';

export interface Sides {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** How the element is sized along one axis, found by probing it in the browser. */
export type AxisSizing = 'hug' | 'fill' | 'fixed';

export interface ColorStopSnapshot {
	color: RGBA;
	/** Where the stop sits; `null` when CSS leaves it to be spread evenly. */
	position: { value: number; unit: '%' | 'px' } | null;
}

export type GradientDirection =
	| { kind: 'angle'; degrees: number }
	/** `to top right` and friends: the angle depends on the box's aspect ratio. */
	| { kind: 'corner'; x: -1 | 1; y: -1 | 1 };

export type BackgroundLayer =
	| { kind: 'linear'; direction: GradientDirection; stops: ColorStopSnapshot[] }
	| { kind: 'radial'; stops: ColorStopSnapshot[] }
	| { kind: 'image'; url: string };

export interface ShadowSnapshot {
	inset: boolean;
	color: RGBA;
	x: number;
	y: number;
	blur: number;
	spread: number;
}

export interface FontSnapshot {
	/** The first family of the font stack that is available, else the first one named. */
	family: string;
	weight: number;
	italic: boolean;
	size: number;
	/** In pixels; `null` for `normal`. */
	lineHeight: number | null;
	letterSpacing: number;
	transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
	decoration: 'none' | 'underline' | 'line-through';
	color: RGBA;
}

export interface StyleSnapshot {
	display: string;
	position: string;
	visible: boolean;
	opacity: number;
	blendMode: string;
	clips: boolean;
	flexDirection: string;
	flexWrap: string;
	flexGrow: number;
	justifyContent: string;
	alignItems: string;
	alignSelf: string;
	rowGap: number;
	columnGap: number;
	padding: Sides;
	margin: Sides;
	borderWidth: Sides;
	borderStyle: string;
	borderColor: RGBA | null;
	/** Top left, top right, bottom right, bottom left. */
	radii: [number, number, number, number];
	background: RGBA | null;
	/** Topmost first, as CSS lists them. */
	backgroundLayers: BackgroundLayer[];
	shadows: ShadowSnapshot[];
	blur: number;
	backdropBlur: number;
	/** `null` for none / auto / 0. */
	minWidth: number | null;
	maxWidth: number | null;
	minHeight: number | null;
	maxHeight: number | null;
	textAlign: string;
	whiteSpace: string;
	font: FontSnapshot;
}

export interface RunSnapshot {
	text: string;
	font: FontSnapshot;
	/** CSS variable the run's colour came from, e.g. `--text-muted`. */
	colorVariable?: string;
}

export interface TextSnapshot {
	/** The box of the laid out text itself (not of the element holding it). */
	box: Rect;
	lines: number;
	paragraphs: RunSnapshot[][];
}

export interface ElementSnapshot {
	kind: 'element';
	tag: string;
	attributes: Record<string, string>;
	box: Rect;
	style: StyleSnapshot;
	sizing: { width: AxisSizing; height: AxisSizing };
	/** CSS property (longhand) to the variable it was written with, e.g. `gap` -> `--space-4`. */
	variables: Record<string, string>;
	children: NodeSnapshot[];
	/** Set when the element holds only inline text: it becomes a text layer. */
	text?: TextSnapshot;
	/** Set for inline `<svg>`: the markup, sized to the box, `currentColor` resolved. */
	svg?: string;
}

/** Loose text beside block elements, e.g. `<div>Hello <p>world</p></div>`. */
export interface TextLeafSnapshot {
	kind: 'text';
	text: TextSnapshot;
	textAlign: string;
}

export type NodeSnapshot = ElementSnapshot | TextLeafSnapshot;

export interface HtmlSnapshot {
	roots: ElementSnapshot[];
	/** What the measuring step could not take over, one line each. */
	warnings: string[];
}
