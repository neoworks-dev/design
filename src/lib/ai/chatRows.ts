// What the chat shows for one run: the recorded events as rows. Pure, so it is tested without a
// DOM. Consecutive text and thought chunks were already merged by the run record.

import type { AiToolStatus } from '../../../electron/bridge';
import type { AiRunRecord } from './types';

export type ChatRow =
	| { kind: 'thought'; key: string; text: string }
	| { kind: 'text'; key: string; text: string }
	| { kind: 'tool'; key: string; name: string; status: AiToolStatus; detail: string }
	| { kind: 'edit'; key: string; label: string; changeCount: number; nodeCount: number }
	| { kind: 'error'; key: string; message: string };

function toolDetail(input: unknown): string {
	if (typeof input !== 'object' || input === null) return '';
	const label = Reflect.get(input, 'label');
	if (typeof label === 'string') return label;
	const ops = Reflect.get(input, 'ops');
	if (Array.isArray(ops)) return ops.length === 1 ? '1 operation' : `${ops.length} operations`;
	return JSON.stringify(input).slice(0, 120);
}

export function chatRowsOf(record: AiRunRecord): ChatRow[] {
	const rows: ChatRow[] = [];
	record.events.forEach((event, position) => {
		const key = `${record.id}:${position}`;
		if (event.type === 'thought') rows.push({ kind: 'thought', key, text: event.text });
		else if (event.type === 'text') rows.push({ kind: 'text', key, text: event.text });
		else if (event.type === 'error') rows.push({ kind: 'error', key, message: event.message });
		else if (event.type === 'tool_call') {
			rows.push({
				kind: 'tool',
				key,
				name: event.name,
				status: event.status,
				detail: toolDetail(event.input)
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
