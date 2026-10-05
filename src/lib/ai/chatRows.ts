// What the chat shows for one run: the recorded events as rows. Pure, so it is tested without a
// DOM. Consecutive text and thought chunks were already merged by the run record.

import type { AiToolStatus } from '../../../electron/bridge';
import type { AiRunRecord, AiToolOutcome } from './types';

export interface ToolImage {
	src: string;
	width: number;
	height: number;
}

export interface ToolOutput {
	ok: boolean;
	text: string;
	/** The picture, when the tool answered with one (screenshot). */
	image: ToolImage | null;
}

export type ChatRow =
	| { kind: 'thought'; key: string; text: string }
	| { kind: 'text'; key: string; text: string }
	| {
			kind: 'tool';
			key: string;
			name: string;
			status: AiToolStatus;
			/** One line: what the call was about. */
			summary: string;
			input: unknown;
			/** What the tool answered, once the renderer has run it. */
			output: ToolOutput | null;
	  }
	| { kind: 'edit'; key: string; label: string; changeCount: number; nodeCount: number }
	| { kind: 'error'; key: string; message: string };

function field(input: unknown, key: string): unknown {
	if (typeof input !== 'object' || input === null) return undefined;
	return Reflect.get(input, key);
}

function stringField(input: unknown, key: string): string | undefined {
	const value = field(input, key);
	if (typeof value === 'string') return value;
	return undefined;
}

function plural(count: number, word: string): string {
	if (count === 1) return `1 ${word}`;
	return `${count} ${word}s`;
}

function readSummary(input: unknown): string {
	const find = stringField(input, 'find');
	if (find !== undefined) return `find "${find}"`;
	const ids = field(input, 'ids');
	if (Array.isArray(ids) && ids.length > 0) return ids.join(', ');
	return 'selection or page';
}

function writeSummary(input: unknown): string {
	const label = stringField(input, 'label');
	if (label !== undefined) return label;
	const replace = stringField(input, 'replace');
	if (replace !== undefined) return `replace ${replace}`;
	const parentId = stringField(input, 'parentId');
	if (parentId !== undefined) return `into ${parentId}`;
	return 'new design';
}

function editSummary(input: unknown): string {
	const label = stringField(input, 'label');
	if (label !== undefined) return label;
	const ops = field(input, 'ops');
	if (Array.isArray(ops)) return plural(ops.length, 'operation');
	return '';
}

/** One line about a call, by tool; other tools show their label or nothing. */
export function toolSummary(name: string, input: unknown): string {
	if (input === undefined) return '';
	if (name === 'read') return readSummary(input);
	if (name === 'write') return writeSummary(input);
	if (name === 'edit') return editSummary(input);
	if (name === 'screenshot') return stringField(input, 'id') ?? 'selection';
	if (name === 'skill') return stringField(input, 'name') ?? '';
	if (name === 'run_command') return stringField(input, 'id') ?? '';
	return stringField(input, 'label') ?? '';
}

function imageOf(text: string): ToolImage | null {
	if (!text.startsWith('{')) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	const base64 = field(parsed, 'base64');
	const mimeType = field(parsed, 'mimeType');
	const width = field(parsed, 'width');
	const height = field(parsed, 'height');
	if (typeof base64 !== 'string' || typeof mimeType !== 'string') return null;
	if (typeof width !== 'number' || typeof height !== 'number') return null;
	return { src: `data:${mimeType};base64,${base64}`, width, height };
}

function outputOf(outcome: AiToolOutcome | undefined): ToolOutput | null {
	if (outcome === undefined) return null;
	const image = imageOf(outcome.text);
	let text = outcome.text;
	if (image !== null) text = `${image.width} × ${image.height} image`;
	return { ok: outcome.ok, text, image };
}

/**
 * The answers of a run's tool calls, matched to its call events: the stream and the tool broker
 * number calls differently, so the n-th call of a tool gets the n-th answer of that tool.
 */
function outcomesByCall(record: AiRunRecord): (name: string) => AiToolOutcome | undefined {
	const remaining = new Map<string, AiToolOutcome[]>();
	for (const outcome of record.toolResults) {
		const list = remaining.get(outcome.tool) ?? [];
		list.push(outcome);
		remaining.set(outcome.tool, list);
	}
	return (name) => remaining.get(name)?.shift();
}

export function chatRowsOf(record: AiRunRecord): ChatRow[] {
	const rows: ChatRow[] = [];
	const nextOutcome = outcomesByCall(record);
	record.events.forEach((event, position) => {
		const key = `${record.id}:${position}`;
		if (event.type === 'thought') rows.push({ kind: 'thought', key, text: event.text });
		else if (event.type === 'text') rows.push({ kind: 'text', key, text: event.text });
		else if (event.type === 'error') rows.push({ kind: 'error', key, message: event.message });
		else if (event.type === 'tool_call') {
			const outcome = nextOutcome(event.name);
			let input = event.input;
			if (outcome !== undefined) input = outcome.input;
			rows.push({
				kind: 'tool',
				key,
				name: event.name,
				status: event.status,
				summary: toolSummary(event.name, input),
				input,
				output: outputOf(outcome)
			});
		} else if (event.type === 'edit') {
			rows.push({
				kind: 'edit',
				key,
				label: event.edit.label,
				changeCount: event.edit.changeCount,
				nodeCount: event.edit.nodeIds.length
			});
		}
	});
	return rows;
}

export interface ToolInputView {
	/** Long string fields (HTML, CSS, text) on their own, as code. */
	blocks: { key: string; text: string }[];
	/** Everything else, pretty-printed; `null` when nothing is left. */
	rest: string | null;
}

const BLOCK_LENGTH = 80;

/** A call's input for reading: long strings apart, the remaining fields as JSON. */
export function toolInputView(input: unknown): ToolInputView {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		if (input === undefined) return { blocks: [], rest: null };
		return { blocks: [], rest: JSON.stringify(input, null, 2) };
	}
	const blocks: { key: string; text: string }[] = [];
	const rest: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (typeof value === 'string' && (value.length > BLOCK_LENGTH || value.includes('\n'))) {
			blocks.push({ key, text: value });
		} else rest[key] = value;
	}
	if (Object.keys(rest).length === 0) return { blocks, rest: null };
	return { blocks, rest: JSON.stringify(rest, null, 2) };
}

/** Tool output for reading: JSON pretty-printed, anything else as it is. */
export function formatToolText(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return text;
	}
}
