// Batch operations of the AI (#152): which layers each one works on, the facts it gathers from
// the document itself, and its prompt. Pure; the `aiBatch` service runs them.
//
//   alt-text       image layers                      -> set_alt_text        (writes)
//   content-fill   empty or placeholder text layers  -> fill_content        (writes)
//   auto-layout    frames with children, no layout   -> convert_to_auto_layout (writes)
//   audit          colors and spacing, counted here  -> a written report   (read only)
//   bindings       values equal to a variable's      -> a written report   (read only)
//
// The audit and binding runs get numbers computed locally, so the model reports on facts instead
// of guessing from a screenshot.

import { plainText, type Node, type NodeId } from '../document';
import { rgbToHex } from './tools/color';

export type BatchOperationId = 'alt-text' | 'content-fill' | 'auto-layout' | 'audit' | 'bindings';

export interface BatchOperation {
	id: BatchOperationId;
	title: string;
	/** The task tag on the first line of the prompt. */
	task: string;
	scope: 'read' | 'write';
	/** Tools the run may use besides the reads. */
	tool: string | undefined;
}

export const BATCH_OPERATIONS: readonly BatchOperation[] = [
	{
		id: 'alt-text',
		title: 'Generate alt text',
		task: 'batch-alt-text',
		scope: 'write',
		tool: 'set_alt_text'
	},
	{
		id: 'content-fill',
		title: 'Fill with placeholder content',
		task: 'batch-content-fill',
		scope: 'write',
		tool: 'fill_content'
	},
	{
		id: 'auto-layout',
		title: 'Convert to auto layout',
		task: 'batch-auto-layout',
		scope: 'write',
		tool: 'convert_to_auto_layout'
	},
	{
		id: 'audit',
		title: 'Audit colors and spacing',
		task: 'batch-audit',
		scope: 'read',
		tool: undefined
	},
	{
		id: 'bindings',
		title: 'Suggest variable bindings',
		task: 'batch-bindings',
		scope: 'read',
		tool: undefined
	}
];

/** The reads every batch run may use (the screenshot helps with alt text). */
export const BATCH_READ_TOOLS: readonly string[] = [
	'get_selection',
	'get_node',
	'query',
	'read_tree',
	'get_screenshot',
	'list_variables',
	'list_styles'
];

type Shape = Exclude<Node, { type: 'PAGE' }>;

export const MAX_BATCH_TARGETS = 80;
export const ALT_TEXT_NAMESPACE = 'ai-batch';
export const ALT_TEXT_KEY = 'altText';

export interface VariableValue {
	id: string;
	name: string;
	type: 'COLOR' | 'FLOAT';
	/** `#rrggbb` for colors, the number for floats. */
	value: string | number;
}

export interface BatchSource {
	get(id: NodeId): Node | undefined;
	children(id: NodeId | null): readonly NodeId[];
	variableValues(): VariableValue[];
}

function walk(source: BatchSource, roots: readonly NodeId[], visit: (node: Node) => boolean): void {
	const step = (id: NodeId): void => {
		const node = source.get(id);
		if (node === undefined || node.type === 'PAGE') return;
		if (!node.visible || node.locked) return;
		if (!visit(node)) return;
		for (const childId of source.children(id)) step(childId);
	};
	for (const id of roots) step(id);
}

function size(node: Node): string {
	if (node.type === 'PAGE') return '';
	return `${Math.round(node.width)}x${Math.round(node.height)}`;
}

export function hasImageFill(node: Node): boolean {
	if (!('fills' in node)) return false;
	return node.fills.some((paint) => paint.type === 'IMAGE' && paint.visible);
}

export function altTextOf(node: Node): string {
	return node.pluginData[ALT_TEXT_NAMESPACE]?.[ALT_TEXT_KEY] ?? '';
}

export interface BatchTarget {
	id: NodeId;
	/** One line of the prompt describing the layer. */
	line: string;
}

export function altTextTargets(source: BatchSource, roots: readonly NodeId[]): BatchTarget[] {
	const targets: BatchTarget[] = [];
	walk(source, roots, (node) => {
		if (targets.length >= MAX_BATCH_TARGETS) return false;
		if (hasImageFill(node) && altTextOf(node) === '') {
			targets.push({
				id: node.id,
				line: `${node.id} | ${node.type} | ${node.name} | ${size(node)}`
			});
		}
		return true;
	});
	return targets;
}

const PLACEHOLDER_TEXT = /^(text|label|title|heading|lorem ipsum.*|placeholder|type something)$/i;

export function isPlaceholderText(characters: string): boolean {
	const trimmed = characters.trim();
	return trimmed === '' || PLACEHOLDER_TEXT.test(trimmed);
}

export function contentFillTargets(source: BatchSource, roots: readonly NodeId[]): BatchTarget[] {
	const targets: BatchTarget[] = [];
	walk(source, roots, (node) => {
		if (targets.length >= MAX_BATCH_TARGETS) return false;
		if (node.type !== 'TEXT') return true;
		const characters = plainText(node.paragraphs);
		if (!isPlaceholderText(characters)) return true;
		let where = '';
		const parent = node.parentId === null ? undefined : source.get(node.parentId);
		if (parent !== undefined) where = parent.name;
		targets.push({
			id: node.id,
			line: `${node.id} | ${node.name} | now "${characters}" | ${size(node)} | in "${where}"`
		});
		return true;
	});
	return targets;
}

export function autoLayoutTargets(source: BatchSource, roots: readonly NodeId[]): BatchTarget[] {
	const targets: BatchTarget[] = [];
	walk(source, roots, (node) => {
		if (targets.length >= MAX_BATCH_TARGETS) return false;
		if (node.type !== 'FRAME' || node.layoutMode !== 'NONE') return true;
		const children = source
			.children(node.id)
			.map((id) => source.get(id))
			.filter((child): child is Shape => child !== undefined && child.type !== 'PAGE')
			.filter((child) => child.visible);
		if (children.length < 2) return true;
		const described = children
			.slice(0, 8)
			.map(
				(child) =>
					`${child.name} ${size(child)} at ${Math.round(child.transform[0][2])},${Math.round(child.transform[1][2])}`
			);
		targets.push({
			id: node.id,
			line: `${node.id} | ${node.name} | ${size(node)} | children: ${described.join('; ')}`
		});
		return true;
	});
	return targets;
}

// ---------- audit ----------

export interface AuditReport {
	/** Unbound solid fill colors with the number of layers using each, most used first. */
	colors: { hex: string; count: number }[];
	/** Spacing values (gap and padding of auto layout frames) with their counts. */
	spacing: { value: number; count: number }[];
	/** Spacing values that are not a multiple of 4. */
	offGrid: number[];
	layers: number;
}

function increment<Key>(counts: Map<Key, number>, key: Key): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

export function auditDocument(source: BatchSource, roots: readonly NodeId[]): AuditReport {
	const colors = new Map<string, number>();
	const spacing = new Map<number, number>();
	let layers = 0;
	walk(source, roots, (node) => {
		layers += 1;
		if ('fills' in node) {
			node.fills.forEach((paint) => {
				if (paint.type !== 'SOLID' || !paint.visible) return;
				if (paint.boundVariables?.color !== undefined) return;
				increment(colors, rgbToHex(paint.color));
			});
		}
		if ('layoutMode' in node && node.layoutMode !== 'NONE') {
			for (const value of [
				node.itemSpacing,
				node.paddingTop,
				node.paddingRight,
				node.paddingBottom,
				node.paddingLeft
			]) {
				if (value > 0) increment(spacing, value);
			}
		}
		return true;
	});
	const sortedColors = [...colors.entries()]
		.map(([hex, count]) => ({ hex, count }))
		.sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
	const sortedSpacing = [...spacing.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => a.value - b.value);
	return {
		colors: sortedColors,
		spacing: sortedSpacing,
		offGrid: sortedSpacing.filter((entry) => entry.value % 4 !== 0).map((entry) => entry.value),
		layers
	};
}

// ---------- bindings ----------

export interface BindingCandidate {
	nodeId: NodeId;
	nodeName: string;
	property: string;
	value: string | number;
	variableId: string;
	variableName: string;
}

const NUMERIC_BINDABLE = [
	'itemSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'cornerRadius'
] as const;

export function bindingCandidates(
	source: BatchSource,
	roots: readonly NodeId[]
): BindingCandidate[] {
	const variables = source.variableValues();
	const colors = variables.filter((variable) => variable.type === 'COLOR');
	const numbers = variables.filter((variable) => variable.type === 'FLOAT');
	const found: BindingCandidate[] = [];
	walk(source, roots, (node) => {
		if (found.length >= MAX_BATCH_TARGETS) return false;
		if ('fills' in node) {
			const paint = node.fills[0];
			if (
				paint !== undefined &&
				paint.type === 'SOLID' &&
				paint.boundVariables?.color === undefined
			) {
				const hex = rgbToHex(paint.color);
				for (const variable of colors.filter((candidate) => candidate.value === hex)) {
					found.push({
						nodeId: node.id,
						nodeName: node.name,
						property: 'fills[0].color',
						value: hex,
						variableId: variable.id,
						variableName: variable.name
					});
				}
			}
		}
		for (const property of NUMERIC_BINDABLE) {
			if (!(property in node)) continue;
			const value = Reflect.get(node, property);
			if (typeof value !== 'number' || value === 0) continue;
			if (node.boundVariables?.[property] !== undefined) continue;
			for (const variable of numbers.filter((candidate) => candidate.value === value)) {
				found.push({
					nodeId: node.id,
					nodeName: node.name,
					property,
					value,
					variableId: variable.id,
					variableName: variable.name
				});
			}
		}
		return true;
	});
	return found;
}

// ---------- prompts ----------

/** `1 layer`, `3 layers`. */
export function plural(count: number, noun: string): string {
	if (count === 1) return `${count} ${noun}`;
	return `${count} ${noun}s`;
}

function scopeNote(selectedCount: number): string {
	if (selectedCount === 0) return 'Scope: the whole current page.';
	return `Scope: the ${plural(selectedCount, 'selected layer')} and what is inside them.`;
}

export function batchPrompt(
	operation: BatchOperation,
	selectedCount: number,
	body: readonly string[]
): string {
	const lines = [`Task: ${operation.task}`, scopeNote(selectedCount), ''];
	lines.push(...instructionsOf(operation));
	lines.push('', ...body);
	return lines.join('\n');
}

function instructionsOf(operation: BatchOperation): string[] {
	if (operation.id === 'alt-text') {
		return [
			'Write alt text for each image layer below: one plain sentence (at most 125 characters) that',
			'says what the image shows, as a screen reader would read it. Use get_screenshot when the name',
			'is not enough. Call set_alt_text once with every layer.',
			'Layers (id | type | name | size):'
		];
	}
	if (operation.id === 'content-fill') {
		return [
			'Replace the empty or placeholder text below with short, realistic copy that fits the layer',
			'name, its size and where it sits. No lorem ipsum. Call fill_content once with every layer.',
			'Layers (id | name | current | size | parent):'
		];
	}
	if (operation.id === 'auto-layout') {
		return [
			'Each frame below has no auto layout. Decide for each whether its children read as a',
			'HORIZONTAL or a VERTICAL stack and call convert_to_auto_layout once with every frame.',
			'Spacing and padding are measured from the current positions.',
			'Frames (id | name | size | children):'
		];
	}
	if (operation.id === 'audit') {
		return [
			'Audit the colors and spacing below and write a short report: colors that look like',
			'near-duplicates of each other, colors used once, spacing values that break a 4px grid, and',
			'what to fix first. Change nothing. Facts, counted in the document:'
		];
	}
	return [
		'Each line below is a value that equals a variable of this file but is not bound to it. Write',
		'a short list of the bindings you suggest, and mention any you would not apply and why. Change',
		'nothing. Candidates (layer | property | value | variable):'
	];
}

export function describeAudit(report: AuditReport): string[] {
	const lines = [`Layers examined: ${report.layers}`];
	lines.push(
		`Unbound solid colors: ${report.colors.map((entry) => `${entry.hex} x${entry.count}`).join(', ') || 'none'}`
	);
	lines.push(
		`Spacing values: ${report.spacing.map((entry) => `${entry.value}px x${entry.count}`).join(', ') || 'none'}`
	);
	lines.push(
		`Off the 4px grid: ${report.offGrid.map((value) => `${value}px`).join(', ') || 'none'}`
	);
	return lines;
}

export function describeCandidate(candidate: BindingCandidate): string {
	return `- ${candidate.nodeId} | ${candidate.nodeName} | ${candidate.property} | ${candidate.value} | ${candidate.variableName}`;
}
