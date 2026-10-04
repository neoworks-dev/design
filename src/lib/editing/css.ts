// CSS for a selection, for "Copy as CSS": the declarations a developer would write for each node's
// size, fills, border, radius, effects, auto layout and text style. Pure: reads a `DocumentReader`.
// This is the built-in code generation provider; other languages plug in beside it later.

import type { Effect, Node, NodeId, Paint, RGB, RGBA, TextNode, DocumentReader } from '../document';
import { copyableIds } from './clipboardPayload';

function trimmed(value: number): string {
	return String(Math.round(value * 100) / 100);
}

function pixels(value: number): string {
	if (value === 0) return '0';
	return `${trimmed(value)}px`;
}

export function cssColor(color: RGB | RGBA, extraOpacity = 1): string {
	const alpha = ('a' in color ? color.a : 1) * extraOpacity;
	const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
	if (alpha >= 1) {
		const hex = [color.r, color.g, color.b]
			.map((value) => channel(value).toString(16).padStart(2, '0'))
			.join('');
		return `#${hex}`;
	}
	return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${trimmed(alpha)})`;
}

function visiblePaints(paints: Paint[]): Paint[] {
	return paints.filter((paint) => paint.visible && paint.type !== 'IMAGE');
}

function paintValue(paint: Paint): string {
	if (paint.type === 'SOLID') return cssColor(paint.color, paint.opacity);
	if (paint.type === 'IMAGE') return 'none';
	const stops = paint.gradientStops
		.map((stop) => `${cssColor(stop.color, paint.opacity)} ${trimmed(stop.position * 100)}%`)
		.join(', ');
	if (paint.type === 'GRADIENT_LINEAR') return `linear-gradient(90deg, ${stops})`;
	if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(circle, ${stops})`;
	return `conic-gradient(${stops})`;
}

function backgroundValue(paints: Paint[]): string | null {
	const visible = visiblePaints(paints);
	if (visible.length === 0) return null;
	// The last fill is the topmost, and CSS lists the topmost layer first.
	const layers = [...visible].reverse().map((paint) => {
		const value = paintValue(paint);
		if (paint.type === 'SOLID') return `linear-gradient(${value}, ${value})`;
		return value;
	});
	if (visible.length === 1 && visible[0].type === 'SOLID') return paintValue(visible[0]);
	return layers.join(', ');
}

function shadowValue(effect: Effect): string | null {
	if (!effect.visible) return null;
	if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') return null;
	const parts = [
		pixels(effect.offset.x),
		pixels(effect.offset.y),
		pixels(effect.radius),
		pixels(effect.spread),
		cssColor(effect.color)
	];
	if (effect.type === 'INNER_SHADOW') parts.unshift('inset');
	return parts.join(' ');
}

function effectDeclarations(effects: Effect[]): string[] {
	const declarations: string[] = [];
	const shadows = effects.map(shadowValue).filter((value) => value !== null);
	if (shadows.length > 0) declarations.push(`box-shadow: ${shadows.join(', ')};`);
	for (const effect of effects) {
		if (!effect.visible) continue;
		if (effect.type === 'LAYER_BLUR')
			declarations.push(`filter: blur(${pixels(effect.radius / 2)});`);
		if (effect.type === 'BACKGROUND_BLUR') {
			declarations.push(`backdrop-filter: blur(${pixels(effect.radius / 2)});`);
		}
	}
	return declarations;
}

const FLEX_ALIGN: Record<string, string> = {
	MIN: 'flex-start',
	CENTER: 'center',
	MAX: 'flex-end',
	SPACE_BETWEEN: 'space-between',
	BASELINE: 'baseline'
};

function layoutDeclarations(node: Node): string[] {
	const mode: unknown = Reflect.get(node, 'layoutMode');
	if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') return [];
	const number = (key: string): number => Number(Reflect.get(node, key));
	const direction = mode === 'HORIZONTAL' ? 'row' : 'column';
	const declarations = ['display: flex;', `flex-direction: ${direction};`];
	if (Reflect.get(node, 'layoutWrap') === 'WRAP') declarations.push('flex-wrap: wrap;');
	declarations.push(
		`justify-content: ${FLEX_ALIGN[String(Reflect.get(node, 'primaryAxisAlignItems'))]};`,
		`align-items: ${FLEX_ALIGN[String(Reflect.get(node, 'counterAxisAlignItems'))]};`,
		`gap: ${pixels(number('itemSpacing'))};`,
		`padding: ${[number('paddingTop'), number('paddingRight'), number('paddingBottom'), number('paddingLeft')].map(pixels).join(' ')};`
	);
	return declarations;
}

function textDeclarations(node: TextNode): string[] {
	const style = node.defaultStyle;
	const declarations = [
		`font-family: '${style.fontName.family}';`,
		`font-size: ${pixels(style.fontSize)};`,
		`font-weight: ${style.fontWeight};`
	];
	if (style.lineHeight.unit === 'PIXELS') {
		declarations.push(`line-height: ${pixels(style.lineHeight.value)};`);
	}
	if (style.lineHeight.unit === 'PERCENT') {
		declarations.push(`line-height: ${trimmed(style.lineHeight.value / 100)};`);
	}
	if (style.letterSpacing.value !== 0) {
		const unit = style.letterSpacing.unit === 'PIXELS' ? 'px' : 'em';
		const value = unit === 'em' ? style.letterSpacing.value / 100 : style.letterSpacing.value;
		declarations.push(`letter-spacing: ${trimmed(value)}${unit};`);
	}
	const align = node.paragraphs[0]?.align;
	if (align !== undefined && align !== 'LEFT') {
		declarations.push(`text-align: ${align === 'JUSTIFIED' ? 'justify' : align.toLowerCase()};`);
	}
	if (style.textDecoration === 'UNDERLINE') declarations.push('text-decoration: underline;');
	if (style.textDecoration === 'STRIKETHROUGH') declarations.push('text-decoration: line-through;');
	if (style.textCase === 'UPPER') declarations.push('text-transform: uppercase;');
	if (style.textCase === 'LOWER') declarations.push('text-transform: lowercase;');
	if (style.textCase === 'TITLE') declarations.push('text-transform: capitalize;');
	const solid = visiblePaints(style.fills)[0];
	if (solid !== undefined && solid.type === 'SOLID') {
		declarations.push(`color: ${cssColor(solid.color, solid.opacity)};`);
	}
	return declarations;
}

function borderDeclaration(node: Node): string | null {
	if (!('strokes' in node)) return null;
	for (const stroke of node.strokes) {
		const paint = visiblePaints(stroke.paints)[0];
		if (paint === undefined || paint.type !== 'SOLID') continue;
		const weight = typeof stroke.weight === 'number' ? stroke.weight : stroke.weight.top;
		const style = stroke.dashPattern.length > 0 ? 'dashed' : 'solid';
		return `border: ${pixels(weight)} ${style} ${cssColor(paint.color, paint.opacity)};`;
	}
	return null;
}

function radiusDeclaration(node: Node): string | null {
	const radius: unknown = Reflect.get(node, 'cornerRadius');
	if (typeof radius === 'number' && radius > 0) return `border-radius: ${pixels(radius)};`;
	if (Array.isArray(radius) && radius.some((value) => Number(value) > 0)) {
		return `border-radius: ${radius.map(Number).map(pixels).join(' ')};`;
	}
	return null;
}

/** The CSS declarations for one node, one per entry. */
export function cssDeclarations(node: Node): string[] {
	if (node.type === 'PAGE') return [];
	const declarations = [`width: ${pixels(node.width)};`, `height: ${pixels(node.height)};`];
	if (node.type === 'TEXT') declarations.push(...textDeclarations(node));
	if (node.type !== 'TEXT' && 'fills' in node) {
		const background = backgroundValue(node.fills);
		if (background !== null) declarations.push(`background: ${background};`);
	}
	for (const optional of [borderDeclaration(node), radiusDeclaration(node)]) {
		if (optional !== null) declarations.push(optional);
	}
	if ('opacity' in node && node.opacity < 1)
		declarations.push(`opacity: ${trimmed(node.opacity)};`);
	if ('effects' in node) declarations.push(...effectDeclarations(node.effects));
	declarations.push(...layoutDeclarations(node));
	return declarations;
}

/** CSS for the selected nodes; with more than one, each block is headed by the layer's name. */
export function exportCss(reader: DocumentReader, ids: readonly NodeId[]): string | null {
	const roots = copyableIds(reader, ids);
	if (roots.length === 0) return null;
	const blocks = roots.map((id) => {
		const node = reader.requireNode(id);
		const lines = cssDeclarations(node);
		if (roots.length === 1) return lines.join('\n');
		return [`/* ${node.name} */`, ...lines].join('\n');
	});
	return blocks.join('\n\n');
}
