// Generate a design from a prompt (#148): the templates, where the result goes and the prompt.
// Pure.
//
// The model writes the design as HTML with one `write` call (see src/lib/ai/html): flexbox becomes
// auto layout, data-component places instances of the document's components, var(--name) binds
// to its variables. One call is one transaction, so a design is either there completely or not at
// all; the run around it is one undo step.

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

export const PLACEMENT_GAP = 100;

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
	/** As CSS custom properties: `--surface`. */
	variableNames: readonly string[];
}

/** The prompt of a generate run. The first line is the task tag the scripted QA agent keys on. */
export function generatePrompt(input: GeneratePromptInput): string {
	const lines = [
		'Task: generate-design',
		`Template: ${input.template.label} (${input.template.width}x${input.template.height})`,
		`Request: ${input.description}`,
		'',
		`Style: ${input.template.guidance}`,
		'',
		`Build the design with ONE write call: one root <div> of exactly ${input.template.width}px`,
		`by ${input.template.height}px holding the whole screen, written as HTML with inline CSS. Use`,
		'flexbox with gap and padding for every group of children so the result stays editable, and',
		'give each element a descriptive data-name. Do not position the root: it is placed beside',
		'the existing work. A failed call changes nothing: read the error and call again. Then',
		'check the result with screenshot.'
	];
	if (input.componentNames.length > 0) {
		lines.push(
			`Components of this file (place one with data-component="<name>" where it fits): ${input.componentNames.join(', ')}`
		);
	}
	if (input.variableNames.length > 0) {
		lines.push(
			`Variables of this file (use them as var(--name); the variables skill lists values): ${input.variableNames.join(', ')}`
		);
	}
	lines.push('', 'Document context:', input.context);
	return lines.join('\n');
}
