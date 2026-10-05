// The document tools the agent calls (MCP-style, plugin-api.md section 3 point 9). Each tool is one
// definition: a name, a description, a zod schema for its arguments (the JSON Schema the model
// sees is generated from it, so schema and validation cannot drift) and a function. Reads answer
// compact JSON with resolved values; writes go through `document.apply` inside one transaction per
// call, tagged `origin: 'ai'` with the run id, so a failing op changes nothing and a whole run
// folds into one undo step (see the ai-history plugin).

import { z } from 'zod';
import {
	createNode,
	generateNodeId,
	indexAtPosition,
	NODE_TYPES,
	plainText,
	type Change,
	type Node,
	type NodeId,
	type NodeType
} from '../../document';
import type { AiService } from '../../services/ai';
import type { CommandsService } from '../../registries/commands.svelte';
import type { DocumentService } from '../../services/document';
import type { HeadlessRendererService } from '../../services/headlessRenderer';
import type { SelectionService } from '../../services/selection';
import type { VariablesService } from '../../services/variables';
import type { AiRunInfo, AiToolHandler } from '../types';
import { pickFields, serializeNode, serializeTree, type TreeSource } from './serialize';
import { translateProps, SETTABLE_PROPERTIES } from './translateProps';

export interface ToolEnvironment {
	document: DocumentService;
	selection: SelectionService;
	commands: CommandsService;
	variables: VariablesService;
	headlessRenderer: HeadlessRendererService;
	ai: Pick<AiService, 'reportEdit' | 'withRun'>;
}

export interface DocumentToolsOptions {
	/** Most operations one `apply_changes` call may carry. */
	maxOpsPerCall: number;
	/** Most delete operations over one whole run; deleting is the destructive part. */
	maxDeletionsPerRun: number;
	/** Command id prefixes `run_command` refuses (app, files, the AI itself, undo). */
	blockedCommandPrefixes: string[];
	/** Largest exported image the model may receive, in encoded bytes. */
	maxImageBytes: number;
	/** Longest text a read tool answers with. */
	maxResultChars: number;
}

export const DEFAULT_TOOL_OPTIONS: DocumentToolsOptions = {
	maxOpsPerCall: 200,
	maxDeletionsPerRun: 50,
	blockedCommandPrefixes: ['app.', 'file.', 'ai.', 'home.', 'tabs.', 'edit.undo', 'edit.redo'],
	maxImageBytes: 1_500_000,
	maxResultChars: 60_000
};

const CREATABLE_TYPES = NODE_TYPES.filter((type) => type !== 'PAGE');

const propsSchema = z
	.record(z.string(), z.unknown())
	.describe(`Node properties. Supported: ${SETTABLE_PROPERTIES.join(', ')}`);

const createOperation = z.strictObject({
	op: z.literal('create'),
	type: z.enum(CREATABLE_TYPES as [NodeType, ...NodeType[]]),
	ref: z.string().optional().describe('A name later ops in this call can use as parentId or id'),
	parentId: z.string().optional().describe('Defaults to the current page'),
	position: z.number().int().min(0).optional().describe('Index among the siblings; default last'),
	props: propsSchema.optional()
});
const setOperation = z.strictObject({
	op: z.literal('set'),
	id: z.string(),
	props: propsSchema
});
const deleteOperation = z.strictObject({ op: z.literal('delete'), id: z.string() });
const moveOperation = z.strictObject({
	op: z.literal('move'),
	id: z.string(),
	parentId: z.string(),
	position: z.number().int().min(0).optional()
});
const operationSchema = z.discriminatedUnion('op', [
	createOperation,
	setOperation,
	deleteOperation,
	moveOperation
]);
type Operation = z.infer<typeof operationSchema>;

const applyChangesInput = z.strictObject({
	label: z.string().optional().describe('Short description of the change'),
	ops: z.array(operationSchema).min(1)
});
const createNodeInput = z.strictObject({
	type: createOperation.shape.type,
	parentId: z.string().optional(),
	position: z.number().int().min(0).optional(),
	props: propsSchema.optional()
});
const setPropsInput = z.strictObject({
	ids: z.array(z.string()).min(1),
	props: propsSchema
});
const readTreeInput = z.strictObject({
	nodeId: z.string().optional().describe('Defaults to the current page'),
	depth: z.number().int().min(0).max(10).optional().describe('Levels below the node; default 3')
});
const getNodeInput = z.strictObject({
	ids: z.array(z.string()).min(1).max(50),
	fields: z.array(z.string()).optional().describe('Raw node properties to return, e.g. fills')
});
const queryInput = z.strictObject({
	type: z.enum(NODE_TYPES).optional(),
	name: z.string().optional().describe('Case-insensitive part of the layer name'),
	text: z.string().optional().describe('Case-insensitive part of a text layer’s characters'),
	rootId: z.string().optional().describe('Search below this node; default the current page'),
	limit: z.number().int().min(1).max(200).optional()
});
const runCommandInput = z.strictObject({ id: z.string(), args: z.unknown().optional() });
const listCommandsInput = z.strictObject({ search: z.string().optional() });
const exportPngInput = z.strictObject({
	nodeId: z.string(),
	scale: z.number().min(0.1).max(4).optional()
});
const noInput = z.strictObject({});
const listVariablesInput = z.strictObject({ collectionId: z.string().optional() });

function json(value: unknown): string {
	return JSON.stringify(value);
}

function describeNode(node: Node): string {
	return `${node.type} ${node.id} "${node.name}"`;
}

function base64Of(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let start = 0; start < bytes.length; start += chunk) {
		binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
	}
	return btoa(binary);
}

interface ApplyOutcome {
	created: { ref?: string; id: NodeId; name: string }[];
	changed: NodeId[];
	deleted: NodeId[];
	changeCount: number;
}

export class DocumentTools {
	private readonly deletionsByRun = new Map<string, number>();

	constructor(
		private readonly env: ToolEnvironment,
		private readonly options: DocumentToolsOptions = DEFAULT_TOOL_OPTIONS
	) {}

	/** A run ended: its deletion count is no longer needed. */
	forgetRun(runId: string): void {
		this.deletionsByRun.delete(runId);
	}

	handlers(): AiToolHandler[] {
		return [
			this.tool(
				'read_tree',
				'The layer tree below a node (default: the current page), compact JSON.',
				false,
				readTreeInput,
				(input) => this.readTree(input.nodeId, input.depth)
			),
			this.tool('get_selection', 'The selected layers of the current page.', false, noInput, () =>
				this.getSelection()
			),
			this.tool(
				'get_node',
				'Details of specific layers, optionally only some raw properties.',
				false,
				getNodeInput,
				(input) => this.getNode(input.ids, input.fields)
			),
			this.tool('query', 'Find layers by type, name or text.', false, queryInput, (input) =>
				this.query(input)
			),
			this.tool(
				'apply_changes',
				'Create, set, move and delete layers in one atomic step. If any op is invalid nothing changes.',
				true,
				applyChangesInput,
				(input, run) => this.applyChanges(input.ops, input.label, run)
			),
			this.tool('create_node', 'Create one layer.', true, createNodeInput, (input, run) =>
				this.applyChanges([{ op: 'create', ...input }], undefined, run)
			),
			this.tool(
				'set_props',
				'Set properties on one or more layers.',
				true,
				setPropsInput,
				(input, run) =>
					this.applyChanges(
						input.ids.map((id) => ({ op: 'set' as const, id, props: input.props })),
						undefined,
						run
					)
			),
			this.tool(
				'run_command',
				'Run an app command by id (see list_commands) on the current selection or document.',
				true,
				runCommandInput,
				(input, run) => this.runCommand(input.id, input.args, run)
			),
			this.tool(
				'list_commands',
				'The commands run_command can run, with their enabled state.',
				false,
				listCommandsInput,
				(input) => this.listCommands(input.search)
			),
			this.tool(
				'export_png',
				'Render a layer to a PNG; the answer carries the image as base64.',
				false,
				exportPngInput,
				(input) => this.exportPng(input.nodeId, input.scale)
			),
			this.tool(
				'list_variables',
				'Variable collections and their variables with values.',
				false,
				listVariablesInput,
				(input) => this.listVariables(input.collectionId)
			),
			this.tool('list_styles', 'The document’s shared styles.', false, noInput, () =>
				this.listStyles()
			),
			this.tool(
				'list_components',
				'The components and component sets of the document.',
				false,
				noInput,
				() => this.listComponents()
			)
		];
	}

	// ---------- plumbing ----------

	private tool<Schema extends z.ZodType>(
		name: string,
		description: string,
		write: boolean,
		schema: Schema,
		run: (input: z.infer<Schema>, run: AiRunInfo) => string | Promise<string>
	): AiToolHandler {
		const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(schema) };
		delete inputSchema.$schema;
		return {
			id: name,
			description,
			write,
			inputSchema,
			run: (input, runInfo) => {
				let args = input;
				if (args === undefined) args = {};
				const parsed = schema.safeParse(args);
				if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
				return run(parsed.data, runInfo);
			}
		};
	}

	private limited(text: string): string {
		if (text.length <= this.options.maxResultChars) return text;
		const kept = text.slice(0, this.options.maxResultChars);
		return `${kept}\n[truncated: answer too long; ask for a smaller part of the tree or use query]`;
	}

	private source(): TreeSource {
		const { document, variables } = this.env;
		return {
			get: (id) => document.get(id),
			children: (id) => document.children(id),
			resolved: (id) => variables.resolvedNode(id)
		};
	}

	private requireNode(id: NodeId): Node {
		const node = this.env.document.get(id);
		if (!node) throw new Error(`node ${id} does not exist; read_tree shows what does`);
		return node;
	}

	// ---------- reads ----------

	private readTree(nodeId: string | undefined, depth: number | undefined): string {
		const rootId = nodeId === undefined ? this.env.document.currentPageId : nodeId;
		this.requireNode(rootId);
		return this.limited(json(serializeTree(this.source(), rootId, { depth })));
	}

	private getSelection(): string {
		const { document, selection } = this.env;
		const source = this.source();
		const page = document.currentPage;
		return json({
			page: { id: page.id, name: page.name },
			count: selection.count,
			nodes: selection.ids.map((id) => serializeNode(source, id))
		});
	}

	private getNode(ids: string[], fields: string[] | undefined): string {
		const source = this.source();
		const nodes = ids.map((id) => {
			this.requireNode(id);
			if (fields === undefined) return serializeNode(source, id);
			return pickFields(source.resolved(id), fields);
		});
		return this.limited(json(nodes));
	}

	private query(input: z.infer<typeof queryInput>): string {
		const { document } = this.env;
		const rootId = input.rootId === undefined ? document.currentPageId : input.rootId;
		this.requireNode(rootId);
		const name = input.name?.toLowerCase();
		const text = input.text?.toLowerCase();
		const matches = document.query((node) => {
			if (input.type !== undefined && node.type !== input.type) return false;
			if (name !== undefined && !node.name.toLowerCase().includes(name)) return false;
			if (text === undefined) return true;
			return node.type === 'TEXT' && plainText(node.paragraphs).toLowerCase().includes(text);
		}, rootId);
		const limit = input.limit === undefined ? 50 : input.limit;
		const source = this.source();
		return this.limited(
			json({
				total: matches.length,
				nodes: matches.slice(0, limit).map((node) => serializeNode(source, node.id))
			})
		);
	}

	private listCommands(search: string | undefined): string {
		const { commands } = this.env;
		const needle = search?.toLowerCase();
		const entries = commands
			.list()
			.filter((command) => !this.isBlockedCommand(command.id))
			.filter((command) => {
				if (needle === undefined) return true;
				return `${command.id} ${command.title}`.toLowerCase().includes(needle);
			})
			.slice(0, 150)
			.map((command) => ({
				id: command.id,
				title: command.title,
				enabled: commands.isEnabled(command.id)
			}));
		return json(entries);
	}

	private async exportPng(nodeId: string, scale: number | undefined): Promise<string> {
		this.requireNode(nodeId);
		const image = await this.env.headlessRenderer.exportNode(nodeId, {
			scale: scale === undefined ? 1 : scale,
			format: 'PNG'
		});
		if (image.bytes.length > this.options.maxImageBytes) {
			throw new Error(
				`the PNG is ${image.bytes.length} bytes, over the ${this.options.maxImageBytes} limit; use a smaller scale`
			);
		}
		return json({
			width: image.width,
			height: image.height,
			mimeType: image.mimeType,
			base64: base64Of(image.bytes)
		});
	}

	private listVariables(collectionId: string | undefined): string {
		const { document, variables } = this.env;
		const collections = document
			.entities('collection')
			.filter((collection) => collectionId === undefined || collection.id === collectionId)
			.map((collection) => ({
				id: collection.id,
				name: collection.name,
				modes: collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name })),
				defaultModeId: collection.defaultModeId
			}));
		const entries = variables.variables(collectionId).map((variable) => ({
			id: variable.id,
			name: variable.name,
			collectionId: variable.collectionId,
			type: variable.resolvedType,
			valuesByMode: variable.valuesByMode,
			resolved: variables.resolveVariable(variable.id)
		}));
		return this.limited(json({ collections, variables: entries }));
	}

	private listStyles(): string {
		const styles = this.env.document
			.entities('style')
			.map((style) => ({ id: style.id, type: style.type, name: style.name, value: style.value }));
		return this.limited(json(styles));
	}

	private listComponents(): string {
		const { document } = this.env;
		const components = document
			.query((node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
			.map((node) => ({
				id: node.id,
				type: node.type,
				name: node.name,
				page: document.pageOf(node.id).name,
				key: node.type === 'COMPONENT' ? node.key : undefined,
				description: node.type === 'COMPONENT' ? node.description : undefined
			}));
		return this.limited(json(components));
	}

	// ---------- writes ----------

	private applyChanges(ops: Operation[], label: string | undefined, run: AiRunInfo): string {
		if (ops.length > this.options.maxOpsPerCall) {
			throw new Error(`too many ops: ${ops.length}; send at most ${this.options.maxOpsPerCall}`);
		}
		const deletions = ops.filter((operation) => operation.op === 'delete').length;
		const used = this.deletionsByRun.get(run.id);
		const total = (used === undefined ? 0 : used) + deletions;
		if (total > this.options.maxDeletionsPerRun) {
			throw new Error(
				`this run may delete at most ${this.options.maxDeletionsPerRun} layers; ask the user first`
			);
		}
		const outcome = this.applyInTransaction(ops, label === undefined ? run.label : label, run);
		this.deletionsByRun.set(run.id, total);
		this.env.ai.reportEdit(run.id, {
			label: label === undefined ? run.label : label,
			nodeIds: [
				...outcome.created.map((entry) => entry.id),
				...outcome.changed,
				...outcome.deleted
			],
			changeCount: outcome.changeCount
		});
		return json({
			applied: ops.length,
			created: outcome.created,
			changed: outcome.changed,
			deleted: outcome.deleted
		});
	}

	private applyInTransaction(ops: Operation[], label: string, run: AiRunInfo): ApplyOutcome {
		const { document } = this.env;
		const outcome: ApplyOutcome = { created: [], changed: [], deleted: [], changeCount: 0 };
		const refs = new Map<string, NodeId>();
		const resolve = (id: string): NodeId => {
			const known = refs.get(id);
			return known === undefined ? id : known;
		};
		const meta = { origin: 'ai' as const, label, runId: run.id };
		document.transaction(meta, () => {
			ops.forEach((operation, position) => {
				try {
					const changes = this.planOperation(operation, resolve, refs, outcome);
					outcome.changeCount += document.apply(changes, meta).changes.length;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`op ${position + 1} (${operation.op}): ${message}`);
				}
			});
		});
		return outcome;
	}

	private planOperation(
		operation: Operation,
		resolve: (id: string) => NodeId,
		refs: Map<string, NodeId>,
		outcome: ApplyOutcome
	): Change[] {
		if (operation.op === 'create') return this.planCreate(operation, resolve, refs, outcome);
		if (operation.op === 'set') return this.planSet(operation, resolve, outcome);
		if (operation.op === 'move') return this.planMove(operation, resolve, outcome);
		return this.planDelete(operation, resolve, outcome);
	}

	private planCreate(
		operation: z.infer<typeof createOperation>,
		resolve: (id: string) => NodeId,
		refs: Map<string, NodeId>,
		outcome: ApplyOutcome
	): Change[] {
		const { document } = this.env;
		const parentId =
			operation.parentId === undefined ? document.currentPageId : resolve(operation.parentId);
		this.requireNode(parentId);
		const siblings = document.children(parentId).length;
		const position = operation.position === undefined ? siblings : operation.position;
		const id = generateNodeId();
		const blank = createNode(operation.type, {
			id,
			parentId,
			index: indexAtPosition(document.reader, parentId, position)
		});
		const props: Record<string, unknown> = {};
		if (operation.props !== undefined) Object.assign(props, operation.props);
		const node = { ...blank, ...translateProps(props, blank) } as Node;
		if (operation.ref !== undefined) refs.set(operation.ref, id);
		outcome.created.push({ ref: operation.ref, id, name: node.name });
		return document.insertNode(node);
	}

	private planSet(
		operation: z.infer<typeof setOperation>,
		resolve: (id: string) => NodeId,
		outcome: ApplyOutcome
	): Change[] {
		const id = resolve(operation.id);
		const node = this.requireNode(id);
		const changes = this.env.document.setProps(id, translateProps(operation.props, node));
		if (changes.length > 0 && !outcome.changed.includes(id)) outcome.changed.push(id);
		return changes;
	}

	private planMove(
		operation: z.infer<typeof moveOperation>,
		resolve: (id: string) => NodeId,
		outcome: ApplyOutcome
	): Change[] {
		const id = resolve(operation.id);
		const node = this.requireNode(id);
		if (node.type === 'PAGE')
			throw new Error(`${describeNode(node)} is a page and cannot be moved`);
		const parentId = resolve(operation.parentId);
		this.requireNode(parentId);
		const siblings = this.env.document.children(parentId).length;
		const position = operation.position === undefined ? siblings : operation.position;
		if (!outcome.changed.includes(id)) outcome.changed.push(id);
		return this.env.document.moveNode(id, parentId, position);
	}

	private planDelete(
		operation: z.infer<typeof deleteOperation>,
		resolve: (id: string) => NodeId,
		outcome: ApplyOutcome
	): Change[] {
		const id = resolve(operation.id);
		const node = this.requireNode(id);
		if (node.type === 'PAGE')
			throw new Error(`${describeNode(node)} is a page and cannot be deleted`);
		outcome.deleted.push(id);
		return this.env.document.removeNode(id);
	}

	private isBlockedCommand(id: string): boolean {
		return this.options.blockedCommandPrefixes.some((prefix) => id.startsWith(prefix));
	}

	private async runCommand(id: string, args: unknown, run: AiRunInfo): Promise<string> {
		const { commands, document, ai } = this.env;
		if (this.isBlockedCommand(id)) throw new Error(`command "${id}" is not available to the agent`);
		if (!commands.has(id)) throw new Error(`unknown command "${id}"; list_commands shows them`);
		if (!commands.isEnabled(id)) {
			throw new Error(`command "${id}" is disabled right now (nothing selected, or wrong context)`);
		}
		const before = document.revision;
		await ai.withRun(run, () => commands.run(id, args));
		const revisions = document.revision - before;
		if (revisions > 0)
			ai.reportEdit(run.id, { label: `Ran ${id}`, nodeIds: [], changeCount: revisions });
		return json({ ran: id, documentChanged: revisions > 0 });
	}
}
