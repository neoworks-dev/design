// The `aiGenerate` service (#148): first-draft designs from a prompt.
//
// `generate` starts an AI run with the template, the request and the document's context. The model
// writes the design as HTML with the general `write` tool, which builds it in one transaction
// beside the existing frames; this service notes the first layer the run wrote (`recordEdit`, fed
// from `ai/edit`) as the generated design. The run is one undo step; a run that is cancelled is
// taken back, so a cancelled generation leaves no trace.

import { Service, type Context } from '@neoworks/extension-system';
import type { Node, NodeId } from '../document';
import { cssVariableName } from '../ai/html/apply';
import {
	generatePrompt,
	templateById,
	type GenerateTemplate,
	type TemplateId
} from '../ai/generate';
import {
	AiConsentRequiredError,
	type AiEditSummary,
	type AiRunInfo,
	type AiRunStatus
} from '../ai/types';
import type { AiGenerateState } from './aiGenerateState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		aiGenerate: AiGenerateService;
	}
}

/** The parts of the `ai` service the generation uses. */
export interface GenerateAi {
	readonly available: boolean;
	run(
		prompt: string,
		options?: { display?: string }
	): { id: string; finished: Promise<AiRunStatus>; cancel(): Promise<void> };
}

export interface GenerateHistory {
	canRevert(runId: string): boolean;
	revertRun(runId: string): void;
}

export interface GenerateContext {
	build(): { text: string };
}

export interface GenerateDocument {
	get(id: NodeId): Node | undefined;
	query(predicate: (node: Node) => boolean): Node[];
}

export interface GenerateVariables {
	variables(): { id: string; name: string }[];
}

export interface GenerateActions {
	openChat(): void;
	/** Select the new design and bring it into view. */
	reveal(id: NodeId): void;
}

export interface GenerateOutcome {
	rootId: NodeId;
	name: string;
	x: number;
	y: number;
	created: number;
}

export interface GenerateResult {
	status: AiRunStatus;
	/** Set when the run built a design and kept it. */
	outcome: GenerateOutcome | undefined;
}

export class AiGenerateService extends Service {
	private readonly generating = new Set<string>();
	private readonly built = new Map<string, GenerateOutcome>();
	private activeRun: { cancel(): Promise<void> } | undefined;

	constructor(
		ctx: Context,
		private readonly ai: GenerateAi,
		private readonly aiContext: GenerateContext,
		private readonly history: GenerateHistory,
		private readonly document: GenerateDocument,
		private readonly variables: GenerateVariables,
		private readonly actions: GenerateActions,
		private readonly state: AiGenerateState
	) {
		super(ctx, 'aiGenerate');
	}

	// ---------- reads (reactive) ----------

	get running(): boolean {
		return this.state.running;
	}

	get notice(): string {
		return this.state.notice;
	}

	get canGenerate(): boolean {
		return this.ai.available && !this.state.running;
	}

	// ---------- actions ----------

	dismiss(): void {
		this.state.notice = '';
	}

	/** Stop the run in flight; what it already built is taken back. */
	async cancel(): Promise<void> {
		await this.activeRun?.cancel();
	}

	/** Generate a design for `description` from the template (the basic app by default). */
	async generate(
		description: string,
		templateId: TemplateId = 'basic-app'
	): Promise<GenerateResult> {
		const text = description.trim();
		const template = templateById(templateId);
		if (text === '' || template === undefined || this.state.running) {
			return { status: 'error', outcome: undefined };
		}
		const run = this.start(text, template);
		if (run === undefined) return { status: 'error', outcome: undefined };
		this.generating.add(run.id);
		this.activeRun = run;
		this.state.running = true;
		this.state.notice = '';
		let status: AiRunStatus = 'error';
		try {
			status = await run.finished;
		} finally {
			this.state.running = false;
			this.generating.delete(run.id);
			this.activeRun = undefined;
		}
		return this.settle(run.id, status);
	}

	/** A write of a generate run: its first layer is the generated design. */
	recordEdit(run: AiRunInfo, edit: AiEditSummary): void {
		if (!this.generating.has(run.id) || this.built.has(run.id)) return;
		const rootId = edit.nodeIds[0];
		if (rootId === undefined) return;
		const root = this.document.get(rootId);
		if (root === undefined || root.type === 'PAGE') return;
		this.built.set(run.id, {
			rootId,
			name: root.name,
			x: root.transform[0][2],
			y: root.transform[1][2],
			created: edit.changeCount
		});
	}

	snapshotState(): Record<string, unknown> {
		return { running: this.state.running, runs: this.generating.size };
	}

	// ---------- internals ----------

	private start(
		text: string,
		template: GenerateTemplate
	): ReturnType<GenerateAi['run']> | undefined {
		const prompt = generatePrompt({
			description: text,
			template,
			context: this.aiContext.build().text,
			componentNames: this.document
				.query((node) => node.type === 'COMPONENT')
				.map((node) => node.name),
			variableNames: this.variables.variables().map((variable) => cssVariableName(variable.name))
		});
		try {
			return this.ai.run(prompt, { display: `Generate: ${text}` });
		} catch (error) {
			if (!(error instanceof AiConsentRequiredError)) throw error;
			this.state.notice = 'Allow the AI for this document in the AI panel, then try again.';
			this.actions.openChat();
			return undefined;
		}
	}

	private settle(runId: string, status: AiRunStatus): GenerateResult {
		const outcome = this.built.get(runId);
		this.built.delete(runId);
		if (outcome === undefined) {
			this.state.notice = this.noticeWithoutDesign(status);
			return { status, outcome: undefined };
		}
		if (status === 'cancelled' || status === 'error') {
			if (this.history.canRevert(runId)) this.history.revertRun(runId);
			this.state.notice = 'Generation stopped: nothing was added.';
			return { status, outcome: undefined };
		}
		this.state.notice = `Generated "${outcome.name}" (${outcome.created} layers).`;
		this.actions.reveal(outcome.rootId);
		return { status, outcome };
	}

	private noticeWithoutDesign(status: AiRunStatus): string {
		if (status === 'cancelled') return 'Generation stopped: nothing was added.';
		if (status === 'error') return 'The AI could not generate a design.';
		return 'The AI did not build a design.';
	}
}
