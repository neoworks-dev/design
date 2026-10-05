// The `aiBatch` service (#152): batch operations of the AI over the selection (or the page).
//
// Each operation is one AI run limited to the reads and one write tool of its own. The tool is the
// guard, as in rename: it only accepts the layers the run was started for, and a failed entry is
// reported while the valid ones are applied in one transaction (one undo step, attributed to the
// run). The audit and the binding suggestions are read-only runs that report in the chat.

import { Service, type Context } from '@neoworks/extension-system';
import type { Change, Node, NodeId } from '../document';
import {
	altTextTargets,
	ALT_TEXT_KEY,
	ALT_TEXT_NAMESPACE,
	auditDocument,
	autoLayoutTargets,
	batchPrompt,
	plural,
	BATCH_OPERATIONS,
	BATCH_READ_TOOLS,
	bindingCandidates,
	contentFillTargets,
	describeAudit,
	describeCandidate,
	type BatchOperation,
	type BatchOperationId,
	type BatchSource,
	type BatchTarget
} from '../ai/batch';
import { translateProps } from '../ai/tools/translateProps';
import {
	AiConsentRequiredError,
	type AiEditSummary,
	type AiEvent,
	type AiRunInfo,
	type AiRunStatus
} from '../ai/types';
import { canGainAutoLayout, planEnableAutoLayout } from '../layout/toggle';
import type { AiBatchState } from './aiBatchState.svelte';
import type { DocumentService } from './document';
import type { SelectionService } from './selection';
import type { VariablesService } from './variables';

declare module '@neoworks/extension-system' {
	interface Context {
		aiBatch: AiBatchService;
	}
}

type Meta = { origin: 'ai'; label: string; runId: string };

/** The parts of the `ai` service the batch uses. */
export interface BatchAi {
	readonly available: boolean;
	run(
		prompt: string,
		options: { scope: 'read' | 'write'; display: string; tools: readonly string[] }
	): { id: string; finished: Promise<AiRunStatus> };
	getRun(id: string): { events: readonly AiEvent[] } | undefined;
	reportEdit(runId: string, edit: AiEditSummary): void;
}

export interface BatchEntry {
	id: string;
	/** Alt text or new characters. */
	text?: string;
	direction?: 'HORIZONTAL' | 'VERTICAL';
}

export interface BatchApplied {
	applied: NodeId[];
	skipped: { id: string; reason: string }[];
}

interface RunPlan {
	operation: BatchOperation;
	allowed: Set<NodeId>;
}

export function operationById(id: BatchOperationId): BatchOperation | undefined {
	return BATCH_OPERATIONS.find((operation) => operation.id === id);
}

function textOf(events: readonly AiEvent[]): string {
	let text = '';
	for (const event of events) {
		if (event.type === 'text') text += event.text;
	}
	return text.trim();
}

export class AiBatchService extends Service {
	private readonly plans = new Map<string, RunPlan>();
	private readonly results = new Map<string, BatchApplied>();

	constructor(
		ctx: Context,
		private readonly ai: BatchAi,
		private readonly document: DocumentService,
		private readonly selection: SelectionService,
		private readonly variables: VariablesService,
		private readonly openChat: () => void,
		private readonly state: AiBatchState
	) {
		super(ctx, 'aiBatch');
	}

	get running(): boolean {
		return this.state.running;
	}

	get notice(): string {
		return this.state.notice;
	}

	dismiss(): void {
		this.state.notice = '';
	}

	/** The layers an operation would work on now (reactive): the selection, else the page. */
	targets(id: BatchOperationId): BatchTarget[] {
		const roots = this.roots();
		if (id === 'alt-text') return altTextTargets(this.source(), roots);
		if (id === 'content-fill') return contentFillTargets(this.source(), roots);
		if (id === 'auto-layout') return autoLayoutTargets(this.source(), roots);
		return [];
	}

	/** Run one batch operation. Resolves with what was applied (write operations). */
	async run(id: BatchOperationId): Promise<BatchApplied | undefined> {
		const operation = operationById(id);
		if (operation === undefined || this.state.running) return undefined;
		const roots = this.roots();
		const prepared = this.prepare(operation, roots);
		if (prepared === undefined) return undefined;
		let run: ReturnType<BatchAi['run']>;
		try {
			run = this.ai.run(batchPrompt(operation, this.selection.count, prepared.body), {
				scope: operation.scope,
				display: operation.title,
				tools: this.toolsOf(operation)
			});
		} catch (error) {
			if (!(error instanceof AiConsentRequiredError)) throw error;
			this.state.notice = 'Allow the AI for this document in the AI panel, then try again.';
			this.openChat();
			return undefined;
		}
		this.plans.set(run.id, { operation, allowed: new Set(prepared.ids) });
		this.state.running = true;
		this.state.notice = '';
		let status: AiRunStatus = 'error';
		try {
			status = await run.finished;
		} finally {
			this.state.running = false;
			this.plans.delete(run.id);
		}
		return this.finish(operation, run.id, status);
	}

	/** Tool `set_alt_text`: store the sentence on each image layer of the run. */
	applyAltText(run: AiRunInfo, entries: readonly BatchEntry[]): BatchApplied {
		return this.applyEntries(run, 'alt-text', 'Generate alt text', entries, (entry, node) => {
			const text = (entry.text ?? '').trim();
			if (text === '') return 'empty text';
			const existing = node.pluginData[ALT_TEXT_NAMESPACE];
			const pluginData = {
				...node.pluginData,
				[ALT_TEXT_NAMESPACE]: { ...existing, [ALT_TEXT_KEY]: text }
			};
			return this.document.setProps(node.id, { pluginData });
		});
	}

	/** Tool `fill_content`: set the characters of each placeholder text layer of the run. */
	applyContent(run: AiRunInfo, entries: readonly BatchEntry[]): BatchApplied {
		return this.applyEntries(run, 'content-fill', 'Fill content', entries, (entry, node) => {
			const text = (entry.text ?? '').trim();
			if (text === '') return 'empty text';
			if (node.type !== 'TEXT') return 'not a text layer';
			return this.document.setProps(node.id, translateProps({ characters: text }, node));
		});
	}

	/** Tool `convert_to_auto_layout`: stack the children of each frame of the run. */
	applyAutoLayout(run: AiRunInfo, entries: readonly BatchEntry[]): BatchApplied {
		return this.applyEntries(
			run,
			'auto-layout',
			'Convert to auto layout',
			entries,
			(entry, node) => {
				if (entry.direction === undefined) return 'no direction';
				if (!canGainAutoLayout(node)) return 'already has auto layout';
				const changes = planEnableAutoLayout(this.document.reader, node, {
					direction: entry.direction
				});
				if (changes.length === 0) return 'nothing to convert';
				return changes;
			}
		);
	}

	snapshotState(): Record<string, unknown> {
		return { running: this.state.running, runs: this.plans.size };
	}

	// ---------- internals ----------

	private roots(): readonly NodeId[] {
		if (this.selection.ids.length > 0) return this.selection.ids;
		return this.document.children(this.document.currentPageId);
	}

	private toolsOf(operation: BatchOperation): readonly string[] {
		if (operation.tool === undefined) return BATCH_READ_TOOLS;
		return [...BATCH_READ_TOOLS, operation.tool];
	}

	private source(): BatchSource {
		const { document, variables } = this;
		return {
			get: (id) => document.get(id),
			children: (id) => document.children(id),
			variableValues: () => this.variableValues(variables)
		};
	}

	private variableValues(variables: VariablesService): ReturnType<BatchSource['variableValues']> {
		const values: ReturnType<BatchSource['variableValues']> = [];
		for (const variable of variables.variables()) {
			const value = variables.resolveVariable(variable.id);
			if (typeof value === 'number') {
				values.push({ id: variable.id, name: variable.name, type: 'FLOAT', value });
			}
			if (typeof value === 'object') {
				const hex = colorHex(value);
				values.push({ id: variable.id, name: variable.name, type: 'COLOR', value: hex });
			}
		}
		return values;
	}

	/** The layers and prompt lines of an operation; `undefined` (with a notice) when none. */
	private prepare(
		operation: BatchOperation,
		roots: readonly NodeId[]
	): { ids: NodeId[]; body: string[] } | undefined {
		const source = this.source();
		if (operation.id === 'audit') {
			const report = auditDocument(source, roots);
			if (report.layers === 0) return this.nothing('There is nothing to audit.');
			return { ids: [], body: describeAudit(report) };
		}
		if (operation.id === 'bindings') {
			const candidates = bindingCandidates(source, roots);
			if (candidates.length === 0) {
				return this.nothing('No value equals a variable of this file that is not bound yet.');
			}
			return { ids: [], body: candidates.map(describeCandidate) };
		}
		const targets = this.targets(operation.id);
		if (targets.length === 0) return this.nothing(emptyNotice(operation.id));
		return {
			ids: targets.map((target) => target.id),
			body: targets.map((target) => `- ${target.line}`)
		};
	}

	private nothing(message: string): undefined {
		this.state.notice = message;
		return undefined;
	}

	private finish(
		operation: BatchOperation,
		runId: string,
		status: AiRunStatus
	): BatchApplied | undefined {
		const applied = this.results.get(runId);
		this.results.delete(runId);
		if (operation.scope === 'read') {
			this.reportReading(runId, status);
			return undefined;
		}
		if (status === 'cancelled') this.state.notice = 'Stopped.';
		else if (applied === undefined || applied.applied.length === 0) {
			this.state.notice = `${operation.title}: the AI changed nothing.`;
		} else {
			this.state.notice = `${operation.title}: ${plural(applied.applied.length, 'layer')}.`;
		}
		return applied;
	}

	private reportReading(runId: string, status: AiRunStatus): void {
		if (status === 'cancelled') {
			this.state.notice = 'Stopped.';
			return;
		}
		const text = this.answerText(runId);
		this.state.notice =
			text === '' ? 'The AI had nothing to report.' : 'Report ready in the AI panel.';
		this.openChat();
	}

	private answerText(runId: string): string {
		const record = this.ai.getRun(runId);
		if (record === undefined) return '';
		return textOf(record.events);
	}

	private applyEntries(
		run: AiRunInfo,
		operationId: BatchOperationId,
		label: string,
		entries: readonly BatchEntry[],
		plan: (entry: BatchEntry, node: Node) => Change[] | string
	): BatchApplied {
		const owned = this.plans.get(run.id);
		if (owned === undefined || owned.operation.id !== operationId) {
			throw new Error('this run was not started for this operation');
		}
		const result: BatchApplied = { applied: [], skipped: [] };
		const meta: Meta = { origin: 'ai', label: run.label, runId: run.id };
		const planned: { id: NodeId; changes: Change[] }[] = [];
		for (const entry of entries) {
			const refusal = this.refusal(owned, entry);
			if (refusal !== undefined) {
				result.skipped.push({ id: entry.id, reason: refusal });
				continue;
			}
			const node = this.document.get(entry.id);
			if (node === undefined) continue;
			const outcome = plan(entry, node);
			if (typeof outcome === 'string') {
				result.skipped.push({ id: entry.id, reason: outcome });
				continue;
			}
			planned.push({ id: entry.id, changes: outcome });
		}
		let changeCount = 0;
		if (planned.length > 0) {
			this.document.transaction(meta, () => {
				for (const item of planned) {
					changeCount += this.document.apply(item.changes, meta).changes.length;
					result.applied.push(item.id);
				}
			});
			this.ai.reportEdit(run.id, { label, nodeIds: result.applied, changeCount });
		}
		const previous = this.results.get(run.id);
		this.results.set(run.id, mergeApplied(previous, result));
		return result;
	}

	private refusal(owned: RunPlan, entry: BatchEntry): string | undefined {
		if (!owned.allowed.has(entry.id)) return 'not one of the layers of this task';
		if (this.document.get(entry.id) === undefined) return 'layer no longer exists';
		return undefined;
	}
}

function emptyNotice(id: BatchOperationId): string {
	if (id === 'alt-text') return 'No image layer without alt text here.';
	if (id === 'content-fill') return 'No empty or placeholder text here.';
	return 'No frame without auto layout and with two or more children here.';
}

function colorHex(value: object): string {
	const r = Reflect.get(value, 'r');
	const g = Reflect.get(value, 'g');
	const b = Reflect.get(value, 'b');
	if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return '';
	const channel = (amount: number): string =>
		Math.round(Math.max(0, Math.min(1, amount)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mergeApplied(previous: BatchApplied | undefined, next: BatchApplied): BatchApplied {
	if (previous === undefined) return next;
	return {
		applied: [...previous.applied, ...next.applied],
		skipped: [...previous.skipped, ...next.skipped]
	};
}
