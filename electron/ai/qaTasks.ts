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
export type TaskScript = (
	prompt: string,
	tools: TaskTools
) => AsyncGenerator<AiStreamEvent> | Generator<AiStreamEvent>;

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

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function label(text: string, size: number, color = '#1a1a1a'): string {
	const safe = escapeHtml(text);
	return `<p data-name="${safe}" style="font-size:${size}px;color:${color}">${safe}</p>`;
}

function card(title: string, body: string, wide: boolean): string {
	const sizing = wide ? 'align-self:stretch' : 'width:240px';
	return [
		`<div data-name="${title} card" style="display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:12px;background:#ffffff;border:1px solid #e1e1e6;${sizing}">`,
		label(title, 18),
		label(body, 14, '#6b6b76'),
		'</div>'
	].join('');
}

/** A small, predictable design for a generate prompt as HTML: header, hero, three cards, footer. */
export function designFor(prompt: string): string {
	const request = /^Request: (.*)$/m.exec(prompt)?.[1] ?? 'Design';
	const size = /^Template: .*\((\d+)x(\d+)\)/m.exec(prompt);
	const width = size ? Number(size[1]) : 390;
	const height = size ? Number(size[2]) : 844;
	const wide = width > 600;
	const component = /Components of this file \(.*?\): ([^,\n]+)/.exec(prompt)?.[1];
	const title = escapeHtml(request.split(/\s+/).slice(0, 4).join(' '));
	const cards = ['Fast', 'Simple', 'Shared'].map((name) => card(name, `${name} by design`, !wide));
	const direction = wide ? 'row' : 'column';
	const parts = [
		`<div data-name="${title}" style="width:${width}px;height:${height}px;display:flex;flex-direction:column;gap:24px;padding:24px;background:#f7f7fb">`,
		`<div data-name="Header" style="display:flex;gap:12px;align-items:center;height:56px">${label(title, 24)}${label('Menu', 14, '#6b6b76')}</div>`,
		`<div data-name="Hero image" style="width:${wide ? 800 : 340}px;height:${wide ? 320 : 200}px;border-radius:16px;background:#c9c4f5"></div>`,
		`<div data-name="Cards" style="display:flex;flex-direction:${direction};gap:16px">${cards.join('')}</div>`
	];
	if (component !== undefined) {
		const safe = escapeHtml(component);
		parts.push(`<div data-name="${safe}" data-component="${safe}"></div>`);
	}
	parts.push(label(`Made with ${request}`, 12, '#8c8c8c'), '</div>');
	return parts.join('');
}

async function* generateDesign(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	yield { type: 'thought', text: 'Sketching the layout, then writing it in one call.' };
	const result: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, 'qa-generate', 'write', { html: designFor(prompt) }, result);
	if (result.value === undefined || !result.value.ok) {
		yield { type: 'text', text: `That did not work: ${result.value?.text ?? 'no answer'}` };
		return;
	}
	yield { type: 'text', text: 'Done: the design is beside your other frames.' };
}

// ---------- palette-command ----------

const COMMAND_PHRASES: [RegExp, string][] = [
	[/align.*left|left.*align/i, 'align.left'],
	[/align.*right|right.*align/i, 'align.right'],
	[/align.*top|top.*align/i, 'align.top'],
	[/align.*bottom|bottom.*align/i, 'align.bottom'],
	[/center|centre/i, 'align.horizontal-center'],
	[/tidy/i, 'align.tidy-up'],
	[/distribut|space.*even|even.*space/i, 'align.distribute-horizontal']
];

/** The command a request is about, when the QA agent knows the phrase. */
export function commandFor(request: string): string | undefined {
	for (const [pattern, id] of COMMAND_PHRASES) {
		if (pattern.test(request)) return id;
	}
	return undefined;
}

async function* paletteCommand(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	const request = /^Request: (.*)$/m.exec(prompt)?.[1] ?? '';
	const wanted = commandFor(request);
	if (wanted === undefined) {
		yield { type: 'text', text: 'I could not find a command for that.' };
		return;
	}
	const listing: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, 'qa-list', 'skill', { name: 'commands' }, listing);
	const known = listing.value?.ok === true && listing.value.text.includes(`- ${wanted}:`);
	if (!known) {
		yield { type: 'text', text: `The command ${wanted} is not available here.` };
		return;
	}
	const ran: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, 'qa-run', 'run_command', { id: wanted }, ran);
	if (ran.value === undefined || !ran.value.ok) {
		yield { type: 'text', text: `That did not work: ${ran.value?.text ?? 'no answer'}` };
		return;
	}
	yield { type: 'text', text: `Ran ${wanted}.` };
}

// ---------- batch operations ----------

/** The lines of a prompt that start with `- `, split into their ` | ` columns. */
export function columnsOf(prompt: string): string[][] {
	return prompt
		.split('\n')
		.filter((line) => line.startsWith('- '))
		.map((line) => line.slice(2).split(' | '));
}

export function altTextFor(name: string): string {
	const words = name.replace(/[-_]+/g, ' ').trim().toLowerCase();
	return `A picture of ${words || 'the subject'}.`;
}

export function contentFor(name: string): string {
	if (/title|heading|headline/i.test(name)) return 'Plan your week';
	if (/button|label|cta/i.test(name)) return 'Get started';
	return 'Fresh ingredients, delivered to your door.';
}

/** Children read as a row when they spread more along x than along y. */
export function directionFor(childrenColumn: string): 'HORIZONTAL' | 'VERTICAL' {
	const points = [...childrenColumn.matchAll(/at (-?\d+),(-?\d+)/g)].map((match) => ({
		x: Number(match[1]),
		y: Number(match[2])
	}));
	if (points.length < 2) return 'VERTICAL';
	const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
	if (spread(points.map((point) => point.x)) > spread(points.map((point) => point.y))) {
		return 'HORIZONTAL';
	}
	return 'VERTICAL';
}

async function* writeItems(
	tools: TaskTools,
	tool: string,
	items: unknown[],
	done: string
): AsyncGenerator<AiStreamEvent> {
	const result: { value: AgentToolResult | undefined } = { value: undefined };
	yield* callTool(tools, `qa-${tool}`, tool, { items }, result);
	if (result.value === undefined || !result.value.ok) {
		yield { type: 'text', text: `That did not work: ${result.value?.text ?? 'no answer'}` };
		return;
	}
	yield { type: 'text', text: `${done} (${items.length}).` };
}

async function* batchAltText(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	const items = columnsOf(prompt).map(([id, , name]) => ({ id, text: altTextFor(name) }));
	yield* writeItems(tools, 'set_alt_text', items, 'Alt text written');
}

async function* batchContentFill(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	const items = columnsOf(prompt).map(([id, name]) => ({ id, text: contentFor(name) }));
	yield* writeItems(tools, 'fill_content', items, 'Copy written');
}

async function* batchAutoLayout(prompt: string, tools: TaskTools): AsyncGenerator<AiStreamEvent> {
	const items = columnsOf(prompt).map((columns) => ({
		id: columns[0],
		direction: directionFor(columns[3] ?? '')
	}));
	yield* writeItems(tools, 'convert_to_auto_layout', items, 'Frames converted');
}

function* batchAudit(prompt: string): Generator<AiStreamEvent> {
	const facts = prompt
		.split('\n')
		.filter((line) =>
			/^(Layers examined|Unbound solid colors|Spacing values|Off the 4px grid):/.test(line)
		);
	yield { type: 'text', text: ['Audit report', ...facts.map((fact) => `- ${fact}`)].join('\n') };
}

function* batchBindings(prompt: string): Generator<AiStreamEvent> {
	const lines = columnsOf(prompt).map(
		([, name, property, value, variable]) => `- ${name}: bind ${property} (${value}) to ${variable}`
	);
	yield { type: 'text', text: ['Suggested bindings', ...lines].join('\n') };
}

export const TASK_SCRIPTS: Record<string, TaskScript> = {
	'rename-layers': renameLayers,
	'search-layers': searchLayers,
	'generate-design': generateDesign,
	'palette-command': paletteCommand,
	'batch-alt-text': batchAltText,
	'batch-content-fill': batchContentFill,
	'batch-auto-layout': batchAutoLayout,
	'batch-audit': batchAudit,
	'batch-bindings': batchBindings
};
