import type { CdpSession } from './cdp';
import type { Point } from './input';

// Roles that carry no meaning on their own; their children are lifted to the parent's level.
const TRANSPARENT_ROLES = new Set([
	'generic',
	'none',
	'presentation',
	'InlineTextBox',
	'LineBreak'
]);

const INTERACTIVE_ROLES = new Set([
	'button',
	'link',
	'textbox',
	'searchbox',
	'combobox',
	'checkbox',
	'radio',
	'switch',
	'slider',
	'spinbutton',
	'tab',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'option',
	'treeitem',
	'listitem',
	'canvas'
]);

interface AxValue {
	value?: unknown;
}

interface AxNode {
	nodeId: string;
	parentId?: string;
	childIds?: string[];
	ignored: boolean;
	role?: AxValue;
	name?: AxValue;
	backendDOMNodeId?: number;
	properties?: { name: string; value: AxValue }[];
}

export interface ProbedElement {
	ref: string;
	role: string;
	name: string;
	backendNodeId: number;
	box: { x: number; y: number; width: number; height: number } | null;
	disabled: boolean;
	depth: number;
}

export async function probeElements(cdp: CdpSession): Promise<ProbedElement[]> {
	await cdp.send('Accessibility.enable');
	const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const root = nodes.find((node) => node.parentId === undefined);
	if (!root) return [];

	const elements: ProbedElement[] = [];
	collect(root, 0, byId, elements);
	for (const element of elements) {
		element.box = await boxOf(cdp, element.backendNodeId);
	}
	return elements;
}

function collect(
	node: AxNode,
	depth: number,
	byId: Map<string, AxNode>,
	elements: ProbedElement[],
	parentName = ''
): void {
	const element = describe(node, depth, elements.length + 1, parentName);
	if (element) elements.push(element);
	let childDepth = depth;
	let childParentName = parentName;
	if (element) {
		childDepth = depth + 1;
		childParentName = element.name;
	}
	for (const childId of node.childIds || []) {
		const child = byId.get(childId);
		if (child) collect(child, childDepth, byId, elements, childParentName);
	}
}

function describe(
	node: AxNode,
	depth: number,
	index: number,
	parentName: string
): ProbedElement | null {
	if (node.ignored || node.backendDOMNodeId === undefined) return null;
	let role = axText(node.role);
	const name = axText(node.name).trim();
	if (TRANSPARENT_ROLES.has(role) || role === 'RootWebArea') return null;
	if (!name && !INTERACTIVE_ROLES.has(role)) return null;
	// Text is listed for orientation, except where it only repeats its parent's accessible name.
	if (role === 'StaticText') {
		if (parentName.includes(name)) return null;
		role = 'text';
	}
	const disabled = (node.properties || []).some(
		(property) => property.name === 'disabled' && property.value.value === true
	);
	return {
		ref: `e${index}`,
		role,
		name,
		backendNodeId: node.backendDOMNodeId,
		box: null,
		disabled,
		depth
	};
}

async function boxOf(cdp: CdpSession, backendNodeId: number): Promise<ProbedElement['box']> {
	try {
		// Content quads work for text nodes too, unlike DOM.getBoxModel.
		const { quads } = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', {
			backendNodeId
		});
		if (quads.length === 0) return null;
		return boundsOfQuads(quads);
	} catch {
		// Not rendered (display: none, zero size) — still listed, but not clickable.
		return null;
	}
}

function boundsOfQuads(quads: number[][]): NonNullable<ProbedElement['box']> {
	const xs = quads.flatMap((quad) => [quad[0], quad[2], quad[4], quad[6]]);
	const ys = quads.flatMap((quad) => [quad[1], quad[3], quad[5], quad[7]]);
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	return {
		x: Math.round(left),
		y: Math.round(top),
		width: Math.round(Math.max(...xs) - left),
		height: Math.round(Math.max(...ys) - top)
	};
}

function axText(value: AxValue | undefined): string {
	if (typeof value?.value === 'string') return value.value;
	return '';
}

export function formatElements(elements: ProbedElement[], filter: string | undefined): string {
	const needle = (filter || '').toLowerCase();
	const lines: string[] = [];
	for (const element of elements) {
		const haystack = `${element.role} ${element.name} ${element.ref}`.toLowerCase();
		if (needle && !haystack.includes(needle)) continue;
		lines.push(formatElement(element, needle ? 0 : element.depth));
	}
	return lines.join('\n');
}

function formatElement(element: ProbedElement, depth: number): string {
	const indent = '  '.repeat(depth);
	let label = `${indent}${element.role}`;
	if (element.name) label += ` "${element.name}"`;
	label += ` ${element.ref}`;
	if (element.disabled) label += ' (disabled)';
	let geometry = '  [hidden]';
	if (element.box) {
		const box = element.box;
		geometry = `  @${box.x},${box.y} ${box.width}x${box.height}`;
	}
	return `${label}${geometry}`;
}

// Resolves a CLI target to a point in the window. Forms: e12, at=x,y, css=selector,
// role=button:Save, or a bare accessible name.
export async function resolveTarget(
	cdp: CdpSession,
	target: string,
	refs: Record<string, number>
): Promise<Point> {
	if (target.startsWith('at=')) return parsePoint(target.slice(3));
	if (target.startsWith('css=')) return centerOfSelector(cdp, target.slice(4));
	if (/^e\d+$/.test(target)) return centerOfRef(cdp, target, refs);
	return centerOfName(cdp, target);
}

export function parsePoint(text: string): Point {
	const [x, y] = text.split(',').map(Number);
	if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad point "${text}", want x,y`);
	return { x, y };
}

async function centerOfRef(
	cdp: CdpSession,
	ref: string,
	refs: Record<string, number>
): Promise<Point> {
	const backendNodeId = refs[ref];
	if (backendNodeId === undefined) throw new Error(`unknown ref ${ref}; run "qa probe" first`);
	const box = await boxOf(cdp, backendNodeId);
	if (!box) throw new Error(`ref ${ref} is stale or hidden; run "qa probe" again`);
	return center(box);
}

async function centerOfSelector(cdp: CdpSession, selector: string): Promise<Point> {
	const expression = `(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	})()`;
	const box = (await cdp.evaluate(expression)) as ProbedElement['box'];
	if (!box) throw new Error(`nothing matches css=${selector}`);
	return center(box);
}

async function centerOfName(cdp: CdpSession, target: string): Promise<Point> {
	let role: string | undefined;
	let name = target;
	if (target.startsWith('role=')) {
		const [rolePart, ...nameParts] = target.slice(5).split(':');
		role = rolePart;
		name = nameParts.join(':');
	}
	const elements = await probeElements(cdp);
	const match = findByName(elements, name, role);
	if (!match?.box)
		throw new Error(`no visible element named "${name}" (role filter: ${role || 'any'})`);
	return center(match.box);
}

function findByName(
	elements: ProbedElement[],
	name: string,
	role: string | undefined
): ProbedElement | undefined {
	const candidates = elements.filter((element) => element.box && (!role || element.role === role));
	const exact = candidates.filter((element) => element.name === name);
	const pool =
		exact.length > 0 ? exact : candidates.filter((element) => matchesLoosely(element, name));
	return pool.find((element) => INTERACTIVE_ROLES.has(element.role)) || pool[0];
}

function matchesLoosely(element: ProbedElement, name: string): boolean {
	return element.name.toLowerCase().includes(name.toLowerCase());
}

function center(box: { x: number; y: number; width: number; height: number }): Point {
	return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}
