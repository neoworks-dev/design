// Generate a design from a prompt (#148): the templates, the spec the model sends, where the
// result goes and the prompt that teaches the tool. Pure.
//
// The model builds the design with one `generate_design` call that carries a nested tree (frames
// with auto layout, text, shapes, instances of the document's components, fills bound to its
// variables). One call is one transaction, so a design is either there completely or not at all;
// the run around it is one undo step.

import { z } from 'zod';
import type { Rect } from '../document';

export type TemplateId = 'basic-app' | 'app-wireframe' | 'basic-site' | 'site-wireframe';

export interface GenerateTemplate {
	id: TemplateId;
	label: string;
	width: number;
	height: number;
	guidance: string;
}

export const TEMPLATES: readonly GenerateTemplate[] = [
	{
		id: 'basic-app',
		label: 'Basic app',
		width: 390,
		height: 844,
		guidance:
			'A polished mobile app screen: a header with title and actions, content sections with realistic copy, a bottom tab bar. Use a consistent colour palette, rounded corners and 16px spacing.'
	},
	{
		id: 'app-wireframe',
		label: 'App wireframe',
		width: 390,
		height: 844,
		guidance:
			'A mobile app wireframe: greyscale only (#f2f2f2, #d9d9d9, #8c8c8c, #1a1a1a), boxes for images, short placeholder labels, no decoration.'
	},
	{
		id: 'basic-site',
		label: 'Basic site',
		width: 1440,
		height: 1024,
		guidance:
			'A desktop landing page: navigation bar, hero with headline, text and a call to action, a row of three feature cards, a footer. Realistic copy, consistent palette.'
	},
	{
		id: 'site-wireframe',
		label: 'Site wireframe',
		width: 1440,
		height: 1024,
		guidance:
			'A desktop page wireframe: greyscale only, boxes for images, placeholder headings and paragraphs, a navigation bar and a footer.'
	}
];

export function templateById(id: string): GenerateTemplate | undefined {
	return TEMPLATES.find((template) => template.id === id);
}

export const MAX_GENERATED_NODES = 250;
export const MAX_GENERATED_DEPTH = 8;
export const PLACEMENT_GAP = 100;

export const GENERATED_TYPES = ['FRAME', 'GROUP', 'RECTANGLE', 'ELLIPSE', 'LINE', 'TEXT'] as const;

export interface NodeSpec {
	type: (typeof GENERATED_TYPES)[number];
	name?: string;
	props?: Record<string, unknown>;
	/** Id or name of a component: the node is an instance of it (type and props are layout only). */
	component?: string;
	/** Name of a COLOR variable the first fill is bound to. */
	fillVariable?: string;
	/** Property name to variable name, for numeric properties like itemSpacing or cornerRadius. */
	bind?: Record<string, string>;
	children?: NodeSpec[];
}

export const nodeSpecSchema: z.ZodType<NodeSpec> = z.lazy(() =>
	z.strictObject({
		type: z.enum(GENERATED_TYPES),
		name: z.string().optional(),
		props: z.record(z.string(), z.unknown()).optional(),
		component: z.string().optional(),
		fillVariable: z.string().optional(),
		bind: z.record(z.string(), z.string()).optional(),
		children: z.array(nodeSpecSchema).optional()
	})
);

export const generateDesignInput = z.strictObject({
	root: nodeSpecSchema.describe(
		'The top frame of the design (type FRAME, with width and height); everything else is nested in children'
	)
});

export interface SpecStats {
	nodes: number;
	depth: number;
}

export function measureSpec(spec: NodeSpec, depth = 1): SpecStats {
	let nodes = 1;
	let deepest = depth;
	for (const child of spec.children ?? []) {
		const inner = measureSpec(child, depth + 1);
		nodes += inner.nodes;
		deepest = Math.max(deepest, inner.depth);
	}
	return { nodes, depth: deepest };
}

/** The first problem that makes a spec unusable, or `undefined`. */
export function specProblem(root: NodeSpec): string | undefined {
	if (root.type !== 'FRAME') return 'the root must be a FRAME';
	const stats = measureSpec(root);
	if (stats.nodes > MAX_GENERATED_NODES) {
		return `too many layers: ${stats.nodes}; send at most ${MAX_GENERATED_NODES}`;
	}
	if (stats.depth > MAX_GENERATED_DEPTH) {
		return `nested too deep: ${stats.depth}; at most ${MAX_GENERATED_DEPTH} levels`;
	}
	return undefined;
}

/**
 * Where a new top-level design of `size` goes: to the right of everything on the page, top
 * aligned with the topmost frame, so it never covers existing work.
 */
export function placeBeside(
	existing: readonly Rect[],
	gap: number = PLACEMENT_GAP
): { x: number; y: number } {
	if (existing.length === 0) return { x: 0, y: 0 };
	const right = Math.max(...existing.map((rect) => rect.x + rect.width));
	const top = Math.min(...existing.map((rect) => rect.y));
	return { x: Math.round(right + gap), y: Math.round(top) };
}

export interface GeneratePromptInput {
	description: string;
	template: GenerateTemplate;
	/** Text from `aiContext.build()`: the page, components, variables, styles, selection. */
	context: string;
	componentNames: readonly string[];
	variableNames: readonly string[];
}

const EXAMPLE = JSON.stringify({
	root: {
		type: 'FRAME',
		name: 'Profile card',
		props: {
			width: 320,
			height: 160,
			layoutMode: 'VERTICAL',
			itemSpacing: 12,
			padding: 16,
			cornerRadius: 12,
			fill: '#ffffff'
		},
		children: [
			{ type: 'TEXT', name: 'Name', props: { characters: 'Ada Lovelace', fontSize: 20 } },
			{
				type: 'FRAME',
				name: 'Actions',
				props: { layoutMode: 'HORIZONTAL', itemSpacing: 8, layoutSizingHorizontal: 'FILL' },
				children: [{ type: 'RECTANGLE', name: 'Avatar', props: { width: 40, height: 40 } }]
			}
		]
	}
});

/** The prompt of a generate run. The first line is the task tag the scripted QA agent keys on. */
export function generatePrompt(input: GeneratePromptInput): string {
	const lines = [
		'Task: generate-design',
		`Template: ${input.template.label} (${input.template.width}x${input.template.height})`,
		`Request: ${input.description}`,
		'',
		`Style: ${input.template.guidance}`,
		'',
		'Build the design with ONE generate_design call. The root is a FRAME of the template size.',
		'Use auto layout (layoutMode HORIZONTAL or VERTICAL with itemSpacing and padding) for every',
		'frame that holds several children, so the result stays editable; give each layer a',
		'descriptive name. Do not set x and y on the root: it is placed beside the existing frames.',
		'A failed call changes nothing: read the error and call again.',
		`Example call: ${EXAMPLE}`
	];
	if (input.componentNames.length > 0) {
		lines.push(
			`Components of this file (use one with "component": "<name>" where it fits): ${input.componentNames.join(', ')}`
		);
	}
	if (input.variableNames.length > 0) {
		lines.push(
			`Variables of this file (bind with "fillVariable" or "bind"): ${input.variableNames.join(', ')}`
		);
	}
	lines.push('', 'Document context:', input.context);
	return lines.join('\n');
}
