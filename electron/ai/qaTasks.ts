// Scripted answers of the QA agent (`DESIGN_QA_AI=fake`) to the task prompts of the AI features.
// A feature starts its prompt with `Task: <name>`; `qaScript` looks the name up here. Each script
// does what a model would do through the document tools, deterministically, so a feature can be
// driven and screenshotted without credentials. The unit tests of the features use their own
// scripts; these exist for QA sessions.

import type { AiStreamEvent } from '../bridge';
import type { AgentToolResult } from '../kernel/agentHost';

export interface TaskTools {
	call(name: string, input: unknown): Promise<AgentToolResult>;
}
export type TaskScript = (prompt: string, tools: TaskTools) => AsyncGenerator<AiStreamEvent>;

/** The `Task: name` of a prompt, or `undefined` for a free-form prompt. */
export function taskOf(prompt: string): string | undefined {
	const match = /^Task: ([\w-]+)/.exec(prompt);
	if (!match) return undefined;
	return match[1];
}

function callEvent(
	callId: string,
	name: string,
	status: 'running' | 'done' | 'failed',
	input?: unknown
): AiStreamEvent {
	return { type: 'tool_call', callId, name, input, status };
}

async function* callTool(
	tools: TaskTools,
	callId: string,
	name: string,
	input: unknown,
	result: { value: AgentToolResult | undefined }
): AsyncGenerator<AiStreamEvent> {
	yield callEvent(callId, name, 'running', input);
	const answer = await tools.call(name, input);
	result.value = answer;
	yield callEvent(callId, name, answer.ok ? 'done' : 'failed');
}

// ---------- rename-layers ----------

const NAME_BY_TYPE: Record<string, string> = {
	FRAME: 'Container',
	GROUP: 'Content Group',
	SECTION: 'Section',
	RECTANGLE: 'Background',
	ELLIPSE: 'Avatar',
	LINE: 'Divider',
	POLYGON: 'Shape',
	STAR: 'Badge',
	COMPONENT: 'Component',
	INSTANCE: 'Instance'
};

function titleCase(text: string): string {
	return text
		.split(/\s+/)
		.filter((word) => word !== '')
		.slice(0, 3)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/** Predictable names: text layers take their first words, shapes a role by type, repeats get a number. */
export function renamesFor(prompt: string): { id: string; name: string }[] {
	const lines = prompt.split('\n').filter((line) => line.startsWith('- '));
	const used = new Map<string, number>();
	const entries: { id: string; name: string }[] = [];
	for (const line of lines) {
		const parts = line.slice(2).split(' | ');
		const [id, type] = parts;
		const text = parts.find((part) => part.startsWith('text "'));
		let base = NAME_BY_TYPE[type];
		if (base === undefined) base = 'Layer';
		if (text !== undefined) base = titleCase(text.slice(6, -1)) || 'Text';
		const seen = used.get(base) ?? 0;
		used.set(base, seen + 1);
		let name = base;
		if (seen > 0) name = `${base} ${seen + 1}`;
		entries.push({ id, name });
	}
	return entries;
}

async function* renameLayers(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	const names = renamesFor(prompt);
	yield { type: 'thought', text: `Naming ${names.length} layers from their content.` };
	const result: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, 'qa-rename', 'rename_layers', { names }, result);
	if (result.value === undefined || !result.value.ok) {
		yield { type: 'text', text: `That did not work: ${result.value?.text ?? 'no answer'}` };
		return;
	}
	let noun = 'layers';
	if (names.length === 1) noun = 'layer';
	yield { type: 'text', text: `Renamed ${names.length} ${noun}.` };
}

// ---------- search-layers ----------

const SEARCH_ALIASES: Record<string, string[]> = {
	sign: ['login', 'log in'],
	signin: ['login'],
	purchase: ['buy', 'checkout', 'cart'],
	picture: ['image', 'photo', 'img'],
	money: ['price', 'pricing', 'plan'],
	round: ['circle', 'ellipse', 'avatar']
};

/** Ids of candidates whose name or text contains a word of the query or one of its aliases. */
export function matchesFor(prompt: string): string[] {
	const query = /^Query: (.*)$/m.exec(prompt)?.[1] ?? '';
	const words = query
		.toLowerCase()
		.split(/\W+/)
		.filter((word) => word !== '');
	const needles = words.flatMap((word) => [word, ...(SEARCH_ALIASES[word] ?? [])]);
	const scored: { id: string; score: number }[] = [];
	for (const line of prompt.split('\n')) {
		if (!line.startsWith('- ')) continue;
		const [id, , name, text] = line.slice(2).split(' | ');
		const haystack = `${name ?? ''} ${text ?? ''}`.toLowerCase();
		const score = needles.filter((needle) => haystack.includes(needle)).length;
		if (score > 0) scored.push({ id, score });
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, 15).map((entry) => entry.id);
}

async function* searchLayers(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	const ids = matchesFor(prompt);
	yield { type: 'thought', text: 'Comparing the query with the candidates by meaning.' };
	const result: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, 'qa-search', 'report_matches', { ids }, result);
	yield { type: 'text', text: `Found ${ids.length} matches.` };
}

// ---------- generate-design ----------

interface DesignSpec {
	type: string;
	name?: string;
	props?: Record<string, unknown>;
	component?: string;
	children?: DesignSpec[];
}

function label(text: string, size: number, color = '#1a1a1a'): DesignSpec {
	return {
		type: 'TEXT',
		name: text,
		props: { characters: text, fontSize: size, textColor: color }
	};
}

function card(title: string, body: string, wide: boolean): DesignSpec {
	return {
		type: 'FRAME',
		name: `${title} card`,
		props: {
			layoutMode: 'VERTICAL',
			itemSpacing: 8,
			padding: 16,
			cornerRadius: 12,
			fill: '#ffffff',
			stroke: '#e1e1e6',
			layoutSizingHorizontal: wide ? 'FILL' : 'FIXED',
			width: 240
		},
		children: [label(title, 18), label(body, 14, '#6b6b76')]
	};
}

/** A small, predictable design for a generate prompt: header, hero, three cards, footer. */
export function designFor(prompt: string): DesignSpec {
	const request = /^Request: (.*)$/m.exec(prompt)?.[1] ?? 'Design';
	const size = /^Template: .*\((\d+)x(\d+)\)/m.exec(prompt);
	const width = size ? Number(size[1]) : 390;
	const height = size ? Number(size[2]) : 844;
	const wide = width > 600;
	const component = /Components of this file \(.*?\): ([^,\n]+)/.exec(prompt)?.[1];
	const title = request.split(/\s+/).slice(0, 4).join(' ');
	const cards = ['Fast', 'Simple', 'Shared'].map((name) => card(name, `${name} by design`, !wide));
	const children: DesignSpec[] = [
		{
			type: 'FRAME',
			name: 'Header',
			props: {
				layoutMode: 'HORIZONTAL',
				itemSpacing: 12,
				counterAxisAlignItems: 'CENTER',
				layoutSizingHorizontal: 'FILL',
				height: 56
			},
			children: [label(title, 24), label('Menu', 14, '#6b6b76')]
		},
		{
			type: 'RECTANGLE',
			name: 'Hero image',
			props: {
				width: wide ? 800 : 340,
				height: wide ? 320 : 200,
				cornerRadius: 16,
				fill: '#c9c4f5'
			}
		},
		{
			type: 'FRAME',
			name: 'Cards',
			props: {
				layoutMode: wide ? 'HORIZONTAL' : 'VERTICAL',
				itemSpacing: 16,
				layoutSizingHorizontal: 'FILL'
			},
			children: cards
		}
	];
	if (component !== undefined) children.push({ type: 'FRAME', name: component, component });
	children.push(label(`Made with ${request}`, 12, '#8c8c8c'));
	return {
		type: 'FRAME',
		name: title,
		props: {
			width,
			height,
			layoutMode: 'VERTICAL',
			itemSpacing: 24,
			padding: 24,
			fill: '#f7f7fb'
		},
		children
	};
}

async function* generateDesign(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	yield { type: 'thought', text: 'Sketching the layout, then building it in one call.' };
	const result: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, 'qa-generate', 'generate_design', { root: designFor(prompt) }, result);
	if (result.value === undefined || !result.value.ok) {
		yield { type: 'text', text: `That did not work: ${result.value?.text ?? 'no answer'}` };
		return;
	}
	yield { type: 'text', text: 'Done: the design is beside your other frames.' };
}

export const TASK_SCRIPTS: Record<string, TaskScript> = {
	'rename-layers': renameLayers,
	'search-layers': searchLayers,
	'generate-design': generateDesign
};
