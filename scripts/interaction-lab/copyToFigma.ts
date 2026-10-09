// Copies a node subtree from one of our .ndesign files into an open Figma file, so a setup found
// in the app can be tried by hand in Figma. Our node data follows Figma's plugin API closely, so
// the page-side builder mostly assigns properties one to one.

import { Database } from 'bun:sqlite';

export interface SourceNode {
	type: string;
	data: Record<string, unknown>;
	children: SourceNode[];
}

interface NodeRow {
	id: string;
	type: string;
	data: string;
}

/** The first node named `name` and its descendants, read without writing to the file. */
export function readSubtree(file: string, name: string): SourceNode {
	const database = new Database(file, { readonly: true });
	try {
		const rows = database.query<NodeRow>('select id, type, data from nodes').all();
		const root = rows.find((row) => parse(row).name === name && row.type !== 'PAGE');
		if (!root) throw new Error(`no node named "${name}" in ${file}`);
		const childrenOf = database.query<NodeRow>(
			'select id, type, data from nodes where parent_id = ? order by idx'
		);
		const build = (row: NodeRow): SourceNode => ({
			type: row.type,
			data: parse(row),
			children: childrenOf.all(row.id).map(build)
		});
		return build(root);
	} finally {
		database.close();
	}
}

function parse(row: NodeRow): Record<string, unknown> {
	const data: Record<string, unknown> = JSON.parse(row.data);
	return data;
}

/** Page-side builder: `(tree, pageName) => summary`, using the `figma` plugin API. */
export const FIGMA_BUILDER = `async (tree, pageName) => {
	const created = { nodes: 0, fontFallbacks: [] };

	const paint = (source) => {
		const result = { type: source.type, visible: source.visible !== false, opacity: source.opacity ?? 1, blendMode: source.blendMode || 'NORMAL' };
		if (source.type === 'SOLID') result.color = { r: source.color.r, g: source.color.g, b: source.color.b };
		else Object.assign(result, source);
		return result;
	};

	const effect = (source) => ({
		type: source.type, visible: source.visible !== false, color: source.color, offset: source.offset,
		radius: source.radius, spread: source.spread || 0, blendMode: source.blendMode || 'NORMAL',
		showShadowBehindNode: !!source.showShadowBehindNode
	});

	async function loadFont(fontName) {
		try {
			await figma.loadFontAsync(fontName);
			return fontName;
		} catch {
			const fallback = { family: 'Inter', style: fontName.style };
			try { await figma.loadFontAsync(fallback); } catch { fallback.style = 'Regular'; await figma.loadFontAsync(fallback); }
			created.fontFallbacks.push(fontName.family + ' ' + fontName.style + ' → ' + fallback.family + ' ' + fallback.style);
			return fallback;
		}
	}

	function create(type) {
		if (type === 'FRAME') return figma.createFrame();
		if (type === 'RECTANGLE') return figma.createRectangle();
		if (type === 'ELLIPSE') return figma.createEllipse();
		if (type === 'TEXT') return figma.createText();
		throw new Error('cannot copy node type ' + type);
	}

	function applyCommon(node, data) {
		node.name = data.name;
		node.visible = data.visible !== false;
		node.opacity = data.opacity ?? 1;
		if (data.blendMode) node.blendMode = data.blendMode;
		if ('fills' in node && Array.isArray(data.fills)) node.fills = data.fills.map(paint);
		if ('strokes' in node && Array.isArray(data.strokes)) node.strokes = data.strokes.map(paint);
		if (Array.isArray(data.effects)) node.effects = data.effects.map(effect);
		if ('cornerRadius' in node && data.cornerRadius !== undefined) {
			if (Array.isArray(data.cornerRadius)) {
				[node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = data.cornerRadius;
			} else node.cornerRadius = data.cornerRadius;
		}
		if (data.constraints) node.constraints = data.constraints;
	}

	function applyAutoLayout(node, data) {
		if (node.type !== 'FRAME') return;
		node.clipsContent = !!data.clipsContent;
		node.layoutMode = data.layoutMode || 'NONE';
		if (node.layoutMode === 'NONE') return;
		node.layoutWrap = data.layoutWrap || 'NO_WRAP';
		node.primaryAxisSizingMode = data.primaryAxisSizingMode;
		node.counterAxisSizingMode = data.counterAxisSizingMode;
		node.primaryAxisAlignItems = data.primaryAxisAlignItems;
		node.counterAxisAlignItems = data.counterAxisAlignItems;
		node.itemSpacing = data.itemSpacing;
		node.paddingTop = data.paddingTop;
		node.paddingRight = data.paddingRight;
		node.paddingBottom = data.paddingBottom;
		node.paddingLeft = data.paddingLeft;
		node.itemReverseZIndex = !!data.itemReverseZIndex;
		node.strokesIncludedInLayout = !!data.strokesIncludedInLayout;
	}

	async function applyText(node, data) {
		const style = data.defaultStyle || {};
		node.fontName = await loadFont(style.fontName || { family: 'Inter', style: 'Regular' });
		node.characters = (data.paragraphs || []).map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\\n');
		if (style.fontSize) node.fontSize = style.fontSize;
		if (style.lineHeight) node.lineHeight = style.lineHeight;
		if (style.letterSpacing) node.letterSpacing = style.letterSpacing;
		if (style.textCase) node.textCase = style.textCase;
		if (style.textDecoration) node.textDecoration = style.textDecoration;
		if (Array.isArray(style.fills)) node.fills = style.fills.map(paint);
		const first = (data.paragraphs || [])[0];
		if (first && first.align) node.textAlignHorizontal = first.align === 'JUSTIFY' ? 'JUSTIFIED' : first.align;
		if (data.textAlignVertical) node.textAlignVertical = data.textAlignVertical;
		node.textAutoResize = data.textAutoResize || 'NONE';
	}

	// Size and position after the node is in its parent: auto layout decides what is settable.
	function applyGeometry(node, data, parent) {
		const inAutoLayout = parent.type === 'FRAME' && parent.layoutMode !== 'NONE';
		if (inAutoLayout && data.layoutPositioning === 'ABSOLUTE') node.layoutPositioning = 'ABSOLUTE';
		const autoText = node.type === 'TEXT' && node.textAutoResize === 'WIDTH_AND_HEIGHT';
		if (!autoText) node.resize(Math.max(0.01, data.width), Math.max(0.01, data.height));
		if (inAutoLayout && data.layoutPositioning !== 'ABSOLUTE') {
			if (data.layoutSizingHorizontal) node.layoutSizingHorizontal = data.layoutSizingHorizontal;
			if (data.layoutSizingVertical) node.layoutSizingVertical = data.layoutSizingVertical;
			return;
		}
		node.x = data.transform[0][2];
		node.y = data.transform[1][2];
	}

	async function build(source, parent) {
		const node = create(source.type);
		parent.appendChild(node);
		created.nodes += 1;
		applyCommon(node, source.data);
		applyAutoLayout(node, source.data);
		if (node.type === 'TEXT') await applyText(node, source.data);
		if (node.type === 'ELLIPSE' && source.data.arcData) node.arcData = source.data.arcData;
		for (const child of source.children) await build(child, node);
		applyGeometry(node, source.data, parent);
		// Hug sizing only takes once the children exist.
		if (node.type === 'FRAME' && node.layoutMode !== 'NONE') {
			node.primaryAxisSizingMode = source.data.primaryAxisSizingMode;
			node.counterAxisSizingMode = source.data.counterAxisSizingMode;
		}
		return node;
	}

	let page = figma.root.children.find((candidate) => candidate.name === pageName);
	if (!page) {
		page = figma.createPage();
		page.name = pageName;
	}
	await page.loadAsync();
	for (const node of [...page.children]) node.remove();
	const root = await build(tree, page);
	figma.commitUndo();
	return { page: page.name, root: root.name, id: root.id, x: root.x, y: root.y, width: root.width, height: root.height, ...created };
}`;
