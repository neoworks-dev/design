// The declarative UI of a plugin: a JSON tree the host renders with its own components. A plugin
// never gets DOM access, it describes what it wants (a stack with a text and a button) and the host
// draws it with the design system; user input comes back as events naming a handler the plugin
// attached to a node (`onClick: 'h3'`). Pure: used by the worker SDK, the host and tests.
//
// Fail closed: a tree is accepted only if every node is a known type with known props (strict
// schemas), nothing is bigger than the limits below, and images are inline data. Anything else is
// rejected as a whole with a message naming the path; the host never renders a node it does not know.
//
// Updates are patches (`diffSurface` / `applySurfacePatch`): replace a node, change its props,
// insert or remove a child, addressed by child-index paths from the root.

import { z } from 'zod';

/** Handler references are strings on the wire; the worker SDK keeps the functions. */
export type HandlerRef = string;

export const MAX_SURFACE_NODES = 3000;
export const MAX_SURFACE_DEPTH = 40;
const MAX_TEXT_LENGTH = 20_000;
const MAX_IMAGE_BYTES = 1_000_000;

export type Gap = 'none' | 'sm' | 'md' | 'lg';
export type Tone = 'default' | 'muted' | 'faint' | 'danger' | 'success';
export type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'success' | 'danger';

export interface StackNode<H> {
	type: 'stack';
	direction?: 'row' | 'column';
	gap?: Gap;
	align?: 'start' | 'center' | 'end' | 'stretch';
	children: SurfaceNode<H>[];
}
export interface SectionNode<H> {
	type: 'section';
	title?: string;
	children: SurfaceNode<H>[];
}
export interface TextNode {
	type: 'text';
	text: string;
	tone?: Tone;
	size?: 'sm' | 'md' | 'lg';
	bold?: boolean;
}
export interface DividerNode {
	type: 'divider';
}
export interface ButtonNode<H> {
	type: 'button';
	label: string;
	variant?: ButtonVariant;
	size?: 'sm' | 'md';
	full?: boolean;
	disabled?: boolean;
	onClick?: H;
}
export interface InputNode<H> {
	type: 'input';
	label?: string;
	value: string;
	placeholder?: string;
	inputType?: 'text' | 'number';
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	onChange?: H;
}
export interface SelectNode<H> {
	type: 'select';
	label?: string;
	value: string;
	options: { value: string; label: string }[];
	disabled?: boolean;
	onChange?: H;
}
export interface ColorNode<H> {
	type: 'color';
	label?: string;
	/** `#rrggbb`. */
	value: string;
	onChange?: H;
}
export interface CheckboxNode<H> {
	type: 'checkbox';
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange?: H;
}
export interface ListNode<H> {
	type: 'list';
	children: SurfaceNode<H>[];
}
export interface ImageNode {
	type: 'image';
	/** An inline `data:image/...;base64,` URL; nothing is fetched. */
	src: string;
	alt: string;
	width?: number;
	height?: number;
}
export interface TabNode<H> {
	type: 'tab';
	id: string;
	label: string;
	children: SurfaceNode<H>[];
}
export interface TabsNode<H> {
	type: 'tabs';
	/** The selected tab id; the first tab when absent. */
	value?: string;
	onChange?: H;
	children: TabNode<H>[];
}

export type SurfaceNode<H = HandlerRef> =
	| StackNode<H>
	| SectionNode<H>
	| TextNode
	| DividerNode
	| ButtonNode<H>
	| InputNode<H>
	| SelectNode<H>
	| ColorNode<H>
	| CheckboxNode<H>
	| ListNode<H>
	| ImageNode
	| TabsNode<H>
	| TabNode<H>;

export type SurfaceNodeType = SurfaceNode['type'];

/** A handler a plugin passes while describing its UI; any function of one value. */
export type UiHandler = (value: never) => unknown;
/** What a plugin writes: the same tree with functions where the wire has handler references. */
export type UiNode = SurfaceNode<UiHandler>;

// ---------- validation ----------

const handler = z.string().min(1).max(200);
const gap = z.enum(['none', 'sm', 'md', 'lg']);
const tone = z.enum(['default', 'muted', 'faint', 'danger', 'success']);
const shortText = z.string().max(MAX_TEXT_LENGTH);
const label = z.string().max(500);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a color like #1a2b3c');
const imageSource = z
	.string()
	.max(MAX_IMAGE_BYTES)
	.regex(/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'an inline image');

function children(): z.ZodArray<z.ZodType<SurfaceNode>> {
	return z.array(z.lazy(() => surfaceNodeSchema));
}

const surfaceNodeSchema: z.ZodType<SurfaceNode> = z.lazy(() =>
	z.discriminatedUnion('type', [
		z.strictObject({
			type: z.literal('stack'),
			direction: z.enum(['row', 'column']).optional(),
			gap: gap.optional(),
			align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
			children: children()
		}),
		z.strictObject({ type: z.literal('section'), title: label.optional(), children: children() }),
		z.strictObject({
			type: z.literal('text'),
			text: shortText,
			tone: tone.optional(),
			size: z.enum(['sm', 'md', 'lg']).optional(),
			bold: z.boolean().optional()
		}),
		z.strictObject({ type: z.literal('divider') }),
		z.strictObject({
			type: z.literal('button'),
			label,
			variant: z.enum(['primary', 'surface', 'ghost', 'success', 'danger']).optional(),
			size: z.enum(['sm', 'md']).optional(),
			full: z.boolean().optional(),
			disabled: z.boolean().optional(),
			onClick: handler.optional()
		}),
		z.strictObject({
			type: z.literal('input'),
			label: label.optional(),
			value: shortText,
			placeholder: label.optional(),
			inputType: z.enum(['text', 'number']).optional(),
			min: z.number().optional(),
			max: z.number().optional(),
			step: z.number().optional(),
			disabled: z.boolean().optional(),
			onChange: handler.optional()
		}),
		z.strictObject({
			type: z.literal('select'),
			label: label.optional(),
			value: z.string().max(500),
			options: z.array(z.strictObject({ value: z.string().max(500), label })).max(500),
			disabled: z.boolean().optional(),
			onChange: handler.optional()
		}),
		z.strictObject({
			type: z.literal('color'),
			label: label.optional(),
			value: hexColor,
			onChange: handler.optional()
		}),
		z.strictObject({
			type: z.literal('checkbox'),
			label,
			checked: z.boolean(),
			disabled: z.boolean().optional(),
			onChange: handler.optional()
		}),
		z.strictObject({ type: z.literal('list'), children: children() }),
		z.strictObject({
			type: z.literal('image'),
			src: imageSource,
			alt: label,
			width: z.number().positive().max(4000).optional(),
			height: z.number().positive().max(4000).optional()
		}),
		z.strictObject({
			type: z.literal('tabs'),
			value: z.string().max(200).optional(),
			onChange: handler.optional(),
			children: z.array(z.lazy(() => tabNodeSchema))
		})
	])
);

const tabNodeSchema: z.ZodType<TabNode<HandlerRef>> = z.lazy(() =>
	z.strictObject({
		type: z.literal('tab'),
		id: z.string().min(1).max(200),
		label,
		children: children()
	})
);

export const SURFACE_NODE_TYPES: readonly SurfaceNodeType[] = [
	'stack',
	'section',
	'text',
	'divider',
	'button',
	'input',
	'select',
	'color',
	'checkbox',
	'list',
	'image',
	'tabs',
	'tab'
];

export type SurfaceResult = { ok: true; tree: SurfaceNode } | { ok: false; error: string };

function pathText(path: readonly number[]): string {
	if (path.length === 0) return 'the root';
	return path.map((index) => `children[${index}]`).join('.');
}

/** Walk the raw value: unknown types, depth and node count, with a message that names the node. */
function inspect(raw: unknown, path: number[], counter: { nodes: number }): string | null {
	if (path.length > MAX_SURFACE_DEPTH) return `nesting is deeper than ${MAX_SURFACE_DEPTH} levels`;
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return `${pathText(path)} is not a node`;
	}
	counter.nodes += 1;
	if (counter.nodes > MAX_SURFACE_NODES) return `more than ${MAX_SURFACE_NODES} nodes`;
	const type: unknown = Reflect.get(raw, 'type');
	if (typeof type !== 'string' || !SURFACE_NODE_TYPES.includes(type as SurfaceNodeType)) {
		return `unknown node type ${JSON.stringify(type)} at ${pathText(path)}`;
	}
	const kids: unknown = Reflect.get(raw, 'children');
	if (!Array.isArray(kids)) return null;
	for (let index = 0; index < kids.length; index += 1) {
		const problem = inspect(kids[index], [...path, index], counter);
		if (problem !== null) return problem;
	}
	return null;
}

/** Validate a tree from a plugin. Rejects the whole tree on the first problem. */
export function validateSurface(raw: unknown): SurfaceResult {
	const problem = inspect(raw, [], { nodes: 0 });
	if (problem !== null) return { ok: false, error: problem };
	const parsed = surfaceNodeSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
	return { ok: true, tree: parsed.data };
}

// ---------- patches ----------

export type SurfacePatch =
	| { op: 'replace'; path: number[]; node: SurfaceNode }
	| { op: 'props'; path: number[]; set: Record<string, unknown>; unset: string[] }
	| { op: 'insert'; path: number[]; index: number; node: SurfaceNode }
	| { op: 'remove'; path: number[]; index: number };

type Fields = Record<string, unknown>;

function fieldsOf(node: SurfaceNode): Fields {
	const fields: Fields = {};
	for (const [key, value] of Object.entries(node)) {
		if (key !== 'children') fields[key] = value;
	}
	return fields;
}

function childrenOf(node: SurfaceNode): SurfaceNode[] {
	if ('children' in node) return node.children as SurfaceNode[];
	return [];
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function diffNode(
	previous: SurfaceNode,
	next: SurfaceNode,
	path: number[],
	ops: SurfacePatch[]
): void {
	if (previous.type !== next.type) {
		ops.push({ op: 'replace', path, node: next });
		return;
	}
	const before = fieldsOf(previous);
	const after = fieldsOf(next);
	const set: Fields = {};
	for (const [key, value] of Object.entries(after)) {
		if (!sameValue(before[key], value)) set[key] = value;
	}
	const unset = Object.keys(before).filter((key) => !(key in after));
	if (Object.keys(set).length > 0 || unset.length > 0) ops.push({ op: 'props', path, set, unset });

	const oldChildren = childrenOf(previous);
	const newChildren = childrenOf(next);
	const shared = Math.min(oldChildren.length, newChildren.length);
	for (let index = 0; index < shared; index += 1) {
		diffNode(oldChildren[index], newChildren[index], [...path, index], ops);
	}
	// Removals from the end first, so earlier indexes stay valid.
	for (let index = oldChildren.length - 1; index >= newChildren.length; index -= 1) {
		ops.push({ op: 'remove', path, index });
	}
	for (let index = oldChildren.length; index < newChildren.length; index += 1) {
		ops.push({ op: 'insert', path, index, node: newChildren[index] });
	}
}

/** The patch that turns `previous` into `next`; empty when they are equal. */
export function diffSurface(previous: SurfaceNode, next: SurfaceNode): SurfacePatch[] {
	const ops: SurfacePatch[] = [];
	diffNode(previous, next, [], ops);
	return ops;
}

function nodeAt(root: SurfaceNode, path: readonly number[]): SurfaceNode {
	let node = root;
	for (const index of path) {
		const kids = childrenOf(node);
		if (index < 0 || index >= kids.length) throw new Error(`no node at ${pathText(path)}`);
		node = kids[index];
	}
	return node;
}

function mutableChildren(node: SurfaceNode, path: readonly number[]): SurfaceNode[] {
	if (!('children' in node)) throw new Error(`${pathText(path)} cannot have children`);
	return node.children as SurfaceNode[];
}

/**
 * Apply `ops` to a copy of `tree`. Throws when an op addresses a node that is not there; the host
 * then asks the plugin for the whole tree again.
 */
export function applySurfacePatch(tree: SurfaceNode, ops: readonly SurfacePatch[]): SurfaceNode {
	let root = structuredClone(tree);
	for (const op of ops) {
		if (op.op === 'replace') {
			if (op.path.length === 0) {
				root = structuredClone(op.node);
				continue;
			}
			const parent = nodeAt(root, op.path.slice(0, -1));
			mutableChildren(parent, op.path)[op.path[op.path.length - 1]] = structuredClone(op.node);
		} else if (op.op === 'props') {
			const node = nodeAt(root, op.path);
			const fields = node as unknown as Fields;
			for (const key of op.unset) Reflect.deleteProperty(fields, key);
			Object.assign(fields, structuredClone(op.set));
		} else if (op.op === 'insert') {
			const parent = nodeAt(root, op.path);
			mutableChildren(parent, op.path).splice(op.index, 0, structuredClone(op.node));
		} else {
			const parent = nodeAt(root, op.path);
			mutableChildren(parent, op.path).splice(op.index, 1);
		}
	}
	return root;
}

/** Validate a patched tree again: a patch must not be a way around the schema. */
export function validatePatched(tree: SurfaceNode): SurfaceResult {
	return validateSurface(tree);
}
