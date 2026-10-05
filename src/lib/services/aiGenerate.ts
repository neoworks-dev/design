// The `aiGenerate` service (#148): first-draft designs from a prompt.
//
// `generate` starts an AI run with the template, the request and the document's context. The model
// answers with one `generate_design` call (the tool this service runs): a nested tree that is
// built in one transaction and placed beside the existing frames. Components of the file become
// instances, fills and numeric properties can be bound to the file's variables. The run is one
// undo step; a run that is cancelled is taken back, so a cancelled generation leaves no trace.

import { Service, type Context } from '@neoworks/extension-system';
import {
	createNode,
	generateNodeId,
	indexAtPosition,
	planCreateInstance,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type Rect
} from '../document';
import {
	generatePrompt,
	measureSpec,
	placeBeside,
	specProblem,
	templateById,
	type GenerateTemplate,
	type NodeSpec,
	type TemplateId
} from '../ai/generate';
import { translateProps } from '../ai/tools/translateProps';
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

type Meta = { origin: 'ai'; label: string; runId: string };

/** The parts of the `ai` service the generation uses. */
export interface GenerateAi {
	readonly available: boolean;
	run(
		prompt: string,
		options?: { display?: string }
	): { id: string; finished: Promise<AiRunStatus>; cancel(): Promise<void> };
	reportEdit(runId: string, edit: AiEditSummary): void;
}

export interface GenerateHistory {
	canRevert(runId: string): boolean;
	revertRun(runId: string): void;
}

export interface GenerateContext {
	build(): { text: string };
}

export interface GenerateDocument {
	readonly currentPageId: NodeId;
	readonly reader: DocumentReader;
	get(id: NodeId): Node | undefined;
	children(id: NodeId | null): readonly NodeId[];
	absoluteBounds(id: NodeId): Rect;
	query(predicate: (node: Node) => boolean): Node[];
	insertNode(node: Node): Change[];
	setProps(id: NodeId, props: Record<string, unknown>): Change[];
	transaction<T>(meta: Meta, run: () => T): T;
	apply(changes: Change[], meta: Meta): { changes: readonly Change[] };
}

export interface GenerateVariables {
	variables(): { id: string; name: string }[];
	bindVariable(nodeId: NodeId, property: string, variableId: string, meta: Meta): void;
	bindPaintColor(
		nodeId: NodeId,
		property: 'fills',
		index: number,
		variableId: string,
		meta: Meta
	): void;
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

	/** The `generate_design` tool: build `root` beside the existing frames, in one transaction. */
	applyDesign(run: AiRunInfo, root: NodeSpec): GenerateOutcome {
		if (!this.generating.has(run.id)) throw new Error('this run was not started to generate');
		if (this.built.has(run.id)) throw new Error('the design was already built; do not call again');
		const problem = specProblem(root);
		if (problem !== undefined) throw new Error(problem);
		const position = this.placement();
		const meta: Meta = { origin: 'ai', label: run.label, runId: run.id };
		let rootId = '';
		this.document.transaction(meta, () => {
			rootId = this.buildNode(root, this.document.currentPageId, meta, position);
		});
		const created = measureSpec(root).nodes;
		let name = root.name ?? 'Frame';
		const built = this.document.get(rootId);
		if (built !== undefined) name = built.name;
		const outcome: GenerateOutcome = {
			rootId,
			name,
			x: position.x,
			y: position.y,
			created
		};
		this.built.set(run.id, outcome);
		this.ai.reportEdit(run.id, {
			label: 'Generate design',
			nodeIds: [rootId],
			changeCount: created
		});
		return outcome;
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
			variableNames: this.variables.variables().map((variable) => variable.name)
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

	/** Beside everything on the current page. */
	private placement(): { x: number; y: number } {
		const bounds = this.document
			.children(this.document.currentPageId)
			.map((id) => this.document.absoluteBounds(id));
		return placeBeside(bounds);
	}

	private buildNode(
		spec: NodeSpec,
		parentId: NodeId,
		meta: Meta,
		position: { x: number; y: number } | undefined
	): NodeId {
		let id: NodeId;
		try {
			id = this.createOne(spec, parentId, meta, position);
			this.bindVariables(id, spec, meta);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${spec.type} "${spec.name ?? ''}": ${message}`, { cause: error });
		}
		for (const child of spec.children ?? []) this.buildNode(child, id, meta, undefined);
		return id;
	}

	private propsOf(
		spec: NodeSpec,
		position: { x: number; y: number } | undefined
	): Record<string, unknown> {
		const props: Record<string, unknown> = { ...spec.props };
		if (spec.name !== undefined) props.name = spec.name;
		if (position !== undefined) {
			props.x = position.x;
			props.y = position.y;
		}
		return props;
	}

	private createOne(
		spec: NodeSpec,
		parentId: NodeId,
		meta: Meta,
		position: { x: number; y: number } | undefined
	): NodeId {
		const slot = this.document.children(parentId).length;
		const index = indexAtPosition(this.document.reader, parentId, slot);
		if (spec.component !== undefined) return this.createInstance(spec, parentId, index, meta);
		const id = generateNodeId();
		const blank = createNode(spec.type, { id, parentId, index });
		const node = { ...blank, ...translateProps(this.propsOf(spec, position), blank) } as Node;
		this.document.apply(this.document.insertNode(node), meta);
		return id;
	}

	private createInstance(spec: NodeSpec, parentId: NodeId, index: string, meta: Meta): NodeId {
		const main = this.findComponent(spec.component ?? '');
		const plan = planCreateInstance(this.document.reader, main.id, { parentId, index });
		this.document.apply(plan.changes, meta);
		const instance = this.document.get(plan.rootId);
		if (instance === undefined) throw new Error('the instance was not created');
		const props = this.propsOf(spec, undefined);
		const changes = this.document.setProps(plan.rootId, translateProps(props, instance));
		if (changes.length > 0) this.document.apply(changes, meta);
		return plan.rootId;
	}

	private findComponent(reference: string): Node {
		const components = this.document.query((node) => node.type === 'COMPONENT');
		const wanted = reference.trim().toLowerCase();
		const found = components.find(
			(node) => node.id === reference || node.name.toLowerCase() === wanted
		);
		if (found !== undefined) return found;
		const names = components.map((node) => node.name).join(', ');
		throw new Error(`no component "${reference}"; the file has: ${names === '' ? 'none' : names}`);
	}

	private bindVariables(id: NodeId, spec: NodeSpec, meta: Meta): void {
		if (spec.fillVariable !== undefined) {
			const variable = this.findVariable(spec.fillVariable);
			this.variables.bindPaintColor(id, 'fills', 0, variable.id, meta);
		}
		for (const [property, name] of Object.entries(spec.bind ?? {})) {
			this.variables.bindVariable(id, property, this.findVariable(name).id, meta);
		}
	}

	private findVariable(name: string): { id: string; name: string } {
		const all = this.variables.variables();
		const wanted = name.trim().toLowerCase();
		const found = all.find((variable) => variable.name.toLowerCase() === wanted);
		if (found !== undefined) return found;
		const names = all.map((variable) => variable.name).join(', ');
		throw new Error(`no variable "${name}"; the file has: ${names === '' ? 'none' : names}`);
	}
}
