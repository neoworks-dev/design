import type { Context } from '@neoworks/extension-system';
import type { Node, NodeId, Paint, TextNode, VectorNetwork } from '../../lib/document';
import { resolveStyle } from '../../lib/document/text';
import { nodeStrokes } from '../../lib/document/shapeGeometry';
import type { TextStyle } from '../../lib/document/types';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import { planFlattenNode, planOutlineStroke, type StrokeArea } from '../../lib/editing/flatten';
import { sortByDocumentOrder, topLevelIds } from '../../lib/editing/selectionOps';
import {
	booleanNetwork,
	groupNetwork,
	shapeNetwork,
	strokeAreaNetwork
} from '../../lib/renderer/flattenGeometry';
import { commandsToNetwork } from '../../lib/vector/fromCommands';
import { parseGlyphOutlineFont, type GlyphOutlineFont } from '../../lib/text/glyphOutlines';
import { textOutlineCommands, textStyles } from '../../lib/text/textOutline';

const MENUS: MenuPlacement[] = [
	{ menu: 'context/canvas', group: '4_boolean', order: 10 },
	{ menu: 'context/layer', group: '4_boolean', order: 10 }
];

/** Parsed outline fonts by the face they were loaded for. Plain data: nothing to undo. */
type FontCache = Map<string, GlyphOutlineFont | null>;

function faceKey(ctx: Context, style: TextStyle): string {
	const { face } = ctx.fonts.resolve(style.fontName);
	return `${face.source}\u0000${face.family}\u0000${face.style}`;
}

/** Loads and parses the faces `node` uses, so the outline can then be built synchronously. */
async function loadFaces(ctx: Context, cache: FontCache, node: TextNode): Promise<void> {
	for (const style of textStyles(node)) {
		const key = faceKey(ctx, style);
		if (cache.has(key)) continue;
		const loaded = await ctx.fonts.load(style.fontName);
		cache.set(key, parseGlyphOutlineFont(loaded.bytes));
	}
}

function textFills(node: TextNode): Paint[] {
	const first = node.paragraphs.flatMap((paragraph) => paragraph.runs).at(0);
	if (first) {
		const fills = resolveStyle(node.defaultStyle, first.style).fills;
		if (fills.length > 0) return fills;
	}
	return node.defaultStyle.fills;
}

/** The text node with its variable bindings applied, as the layout sees it. */
function resolvedText(ctx: Context, id: NodeId): TextNode | undefined {
	const node = ctx.variables.resolvedNode(id);
	if (node.type !== 'TEXT') return undefined;
	return node;
}

function textNetwork(ctx: Context, cache: FontCache, node: TextNode): VectorNetwork | null {
	const layout = ctx.textLayout.layoutOf(node);
	const commands = textOutlineCommands(
		node,
		layout,
		ctx.textLayout.engine.blockOffsetY(node),
		(style) => cache.get(faceKey(ctx, style)) ?? undefined
	);
	if (commands.length === 0) return null;
	return commandsToNetwork(commands, 'NONZERO');
}

/** The fills of the topmost thing a group holds that has a visible fill. */
function groupFills(ctx: Context, id: NodeId): Paint[] | undefined {
	const stack = [...ctx.document.children(id)];
	let found: Paint[] | undefined;
	while (stack.length > 0) {
		const child = ctx.document.get(stack.shift() ?? '');
		if (!child) continue;
		if ('fills' in child && child.fills.some((paint) => paint.visible)) found = child.fills;
		if (child.type === 'GROUP') stack.push(...ctx.document.children(child.id));
	}
	return found;
}

function operandSource(ctx: Context): {
	getNode: (id: NodeId) => Node | undefined;
	children: (id: NodeId) => readonly NodeId[];
} {
	return {
		getNode: (id) => ctx.document.get(id),
		children: (id) => ctx.document.children(id)
	};
}

function flattenOne(ctx: Context, cache: FontCache, id: NodeId): NodeId | null {
	const node = ctx.document.get(id);
	if (!node || node.type === 'PAGE') return null;
	const { kit } = ctx.canvaskit;
	if (node.type === 'TEXT') {
		const text = resolvedText(ctx, id);
		if (!text) return null;
		return planAndApply(ctx, id, textNetwork(ctx, cache, text), textFills(text));
	}
	if (node.type === 'BOOLEAN_OPERATION') {
		return planAndApply(ctx, id, booleanNetwork(kit, operandSource(ctx), node));
	}
	if (node.type === 'GROUP') {
		return planAndApply(ctx, id, groupNetwork(kit, operandSource(ctx), node), groupFills(ctx, id));
	}
	if (node.type === 'VECTOR' || node.type === 'FRAME') return null;
	return planAndApply(ctx, id, shapeNetwork(kit, node));
}

function planAndApply(
	ctx: Context,
	id: NodeId,
	network: VectorNetwork | null,
	fills?: Paint[]
): NodeId | null {
	if (!network) return null;
	const plan = planFlattenNode(ctx.document.reader, id, network, fills);
	if (!plan) return null;
	applyEdit(ctx, plan.changes, 'Flatten');
	return plan.vectorId;
}

function selectedTopLevel(ctx: Context): NodeId[] {
	return sortByDocumentOrder(
		ctx.document.reader,
		topLevelIds(ctx.document.reader, ctx.selection.ids)
	);
}

async function flattenSelection(ctx: Context, cache: FontCache): Promise<void> {
	const ids = selectedTopLevel(ctx);
	for (const id of ids) {
		const text = resolvedText(ctx, id);
		if (text) await loadFaces(ctx, cache, text);
	}
	const flattened: NodeId[] = [];
	const handle = ctx.history.beginGroup({ label: 'Flatten' });
	try {
		for (const id of ids) {
			const vectorId = flattenOne(ctx, cache, id);
			if (vectorId !== null) flattened.push(vectorId);
		}
	} finally {
		ctx.history.endGroup(handle);
	}
	if (flattened.length > 0) ctx.selection.select(flattened);
}

function strokeAreas(ctx: Context, id: NodeId): StrokeArea[] {
	const node = ctx.document.get(id);
	if (!node || node.type === 'PAGE') return [];
	const areas: StrokeArea[] = [];
	for (const stroke of nodeStrokes(node)) {
		if (!stroke.paints.some((paint) => paint.visible)) continue;
		const network = strokeAreaNetwork(ctx.canvaskit.kit, node, stroke);
		if (network) areas.push({ stroke, network });
	}
	return areas;
}

function outlineStrokes(ctx: Context): void {
	const outlined: NodeId[] = [];
	const handle = ctx.history.beginGroup({ label: 'Outline stroke' });
	try {
		for (const id of selectedTopLevel(ctx)) {
			const plan = planOutlineStroke(ctx.document.reader, id, strokeAreas(ctx, id));
			if (!plan) continue;
			applyEdit(ctx, plan.changes, 'Outline stroke');
			outlined.push(...plan.vectorIds);
		}
	} finally {
		ctx.history.endGroup(handle);
	}
	if (outlined.length > 0) ctx.selection.select(outlined);
}

// Flatten (Ctrl+E) and Outline stroke (Ctrl+Alt+O), docs/research/interactions.md sections 7 and
// 13. Flatten replaces each selected shape, boolean, group or text by one VECTOR node holding its
// geometry as a vector network (text from the font's glyph outlines at the shaped positions);
// Outline stroke turns the strokes of the selection into VECTOR fills, keeping a node's fill and
// putting the stroke vectors right above it. Each command is one undo step.
export default {
	name: 'flatten',
	inject: [
		'canvaskit',
		'document',
		'selection',
		'history',
		'commands',
		'keymap',
		'menus',
		'fonts',
		'textLayout',
		'variables'
	],
	apply(ctx: Context): void {
		const cache: FontCache = new Map();
		contributeCommand(ctx, {
			id: 'flatten.selection',
			title: 'Flatten',
			when: 'hasSelection',
			run: () => {
				flattenSelection(ctx, cache).catch((error: unknown) => ctx.logger.error(error));
			},
			keys: ['Mod+E'],
			menus: MENUS
		});
		contributeCommand(ctx, {
			id: 'flatten.outline-stroke',
			title: 'Outline stroke',
			when: 'hasSelection',
			run: () => outlineStrokes(ctx),
			keys: ['Mod+Alt+O'],
			menus: [
				{ menu: 'context/canvas', group: '4_boolean', order: 11 },
				{ menu: 'context/layer', group: '4_boolean', order: 11 }
			]
		});
	}
};
