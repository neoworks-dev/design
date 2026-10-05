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

export const TASK_SCRIPTS: Record<string, TaskScript> = {
	'rename-layers': renameLayers
};
