// The five general tools the agent works with (plus the task tools plugins add for their own
// runs). The document reads and writes as HTML, which models know far better than our node
// schema; details live in skills the agent loads on demand instead of in long tool descriptions.
//
//   read        layers (default: the selection, else the page) as HTML with data-ids
//   write       HTML in: insert it, or rewrite a layer keeping what still carries its data-id
//   edit        small changes without rewriting: CSS on one layer, its text or name, delete, move,
//               run an app command
//   screenshot  a PNG of a layer as the user sees it
//   skill       guidance on a topic (html, edit, components, variables, commands, ...)
//
// Every write goes through `document.apply` tagged `origin: 'ai'` with the run id, in one
// transaction per call, and is reported with `ai.reportEdit` so the run folds into one undo step.

import { z } from 'zod';
import { plainText, type Node, type NodeId, type Paragraph } from '../../document';
import { serializeSvg } from '../../export/svg';
import type { CommandsService } from '../../registries/commands.svelte';
import type { AiService } from '../../services/ai';
import type { DocumentService } from '../../services/document';
import type { HeadlessRendererService } from '../../services/headlessRenderer';
import type { SelectionService } from '../../services/selection';
import type { VariablesService } from '../../services/variables';
import type { HtmlMeasurer } from '../../services/htmlLayout';
import { applyHtml, variableCss, type HtmlTarget } from '../html/apply';
import { serializeHtml } from '../html/serialize';
import type { AiRunInfo, AiSkill, AiToolHandler } from '../types';
import type { TreeSource } from './serialize';

export interface CoreToolEnvironment {
	document: DocumentService;
	selection: SelectionService;
	commands: CommandsService;
	variables: VariablesService;
	headlessRenderer: HeadlessRendererService;
	htmlLayout: HtmlMeasurer;
	ai: Pick<AiService, 'reportEdit' | 'withRun' | 'skillText' | 'skills'>;
}

export interface CoreToolOptions {
	/** Most layers one AI run may remove. */
	maxDeletionsPerRun: number;
	/** Command id prefixes the agent may not run (app, files, the AI itself, undo). */
	blockedCommandPrefixes: string[];
	/** Largest image the model may receive, in encoded bytes. */
	maxImageBytes: number;
	/** Longest text a read answers with. */
	maxResultChars: number;
}

export const DEFAULT_CORE_TOOL_OPTIONS: CoreToolOptions = {
	maxDeletionsPerRun: 50,
	blockedCommandPrefixes: [
		'app.',
		'file.',
		'ai.',
		'ai-',
		'home.',
		'tabs.',
		'edit.undo',
		'edit.redo'
	],
	maxImageBytes: 1_500_000,
	maxResultChars: 60_000
};

const SCREENSHOT_LONGEST_SIDE = 1600;
const READ_DEPTH = 6;
const OVERVIEW_DEPTH = 2;
const FIND_LIMIT = 30;

const readInput = z.strictObject({
	ids: z
		.array(z.string())
		.optional()
		.describe('data-ids of the layers to read; default the selection, else the whole page'),
	depth: z.number().int().min(0).max(20).optional().describe('Levels below each layer; default 6'),
	find: z
		.string()
		.optional()
		.describe('Lists the layers whose name or text contains this (case-insensitive)')
});

const writeInput = z.strictObject({
	html: z.string().min(1).describe('HTML with inline CSS or a <style> element'),
	replace: z
		.string()
		.optional()
		.describe(
			'data-id of a layer to rewrite: the HTML (one root element) replaces it; layers whose data-id it keeps stay the same layers'
		),
	parentId: z
		.string()
		.optional()
		.describe('Insert under this layer; default the page, beside the existing work'),
	position: z.number().int().min(0).optional().describe('Index among the siblings; default last'),
	label: z.string().optional().describe('Short description of the change')
});

const editOperation = z.union([
	z.strictObject({
		id: z.string(),
		css: z.string().optional().describe('CSS declarations to set on the layer, e.g. "gap: 12px"'),
		text: z.string().optional().describe('New text of a text layer; lines become paragraphs'),
		name: z.string().optional()
	}),
	z.strictObject({ delete: z.string().describe('data-id of the layer to remove') }),
	z.strictObject({
		move: z.string().describe('data-id of the layer to move'),
		parentId: z.string(),
		position: z.number().int().min(0).optional()
	}),
	z.strictObject({
		command: z.string().describe('An app command id (see the commands skill)'),
		args: z.unknown().optional()
	})
]);
type EditOperation = z.infer<typeof editOperation>;

const editInput = z.strictObject({
	ops: z.array(editOperation).min(1),
	label: z.string().optional()
});

const screenshotInput = z.strictObject({
	id: z.string().optional().describe('Layer to show; default the selection, else the first frame'),
	scale: z.number().min(0.1).max(4).optional()
});

const runCommandInput = z.strictObject({ id: z.string(), args: z.unknown().optional() });

const skillInput = z.strictObject({ name: z.string().describe('The skill to load') });

const VECTOR_TYPES = new Set(['VECTOR', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION']);

function json(value: unknown): string {
	return JSON.stringify(value);
}

export function base64Of(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let start = 0; start < bytes.length; start += chunk) {
		binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
	}
	return btoa(binary);
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function paragraphsOf(text: string, template: Paragraph | undefined): Paragraph[] {
	return text.split('\n').map((line) => ({
		runs: [{ text: line, style: {} }],
		align: template?.align ?? 'LEFT',
		indent: 0,
		spacingAfter: template?.spacingAfter ?? 0,
		list: 'NONE',
		listLevel: 0
	}));
}

export class CoreTools {
	private readonly deletionsByRun = new Map<string, number>();

	constructor(
		private readonly env: CoreToolEnvironment,
		private readonly options: CoreToolOptions = DEFAULT_CORE_TOOL_OPTIONS
	) {}

	forgetRun(runId: string): void {
		this.deletionsByRun.delete(runId);
	}

	handlers(): AiToolHandler[] {
		return [
			this.tool(
				'read',
				'The layers as HTML with data-ids (default: the selection, else the page). With find: layers whose name or text matches.',
				false,
				readInput,
				(input) => this.read(input)
			),
			this.tool(
				'write',
				'Put HTML into the design: insert it (under parentId, default beside the existing work), or rewrite the layer given by replace. One call is one undoable step.',
				true,
				writeInput,
				(input, run) => this.write(input, run)
			),
			this.tool(
				'edit',
				'Small changes without rewriting HTML: CSS, text or name of a layer; delete; move; run an app command.',
				true,
				editInput,
				(input, run) => this.edit(input.ops, input.label, run)
			),
			this.tool(
				'screenshot',
				'A PNG of a layer as the user sees it (default: the selection, else the first frame). Use it to check your work.',
				false,
				screenshotInput,
				(input) => this.screenshot(input.id, input.scale)
			),
			{
				...this.tool(
					'run_command',
					'Run an app command by id (see the commands skill) on the current selection. Only for runs that are limited to commands.',
					true,
					runCommandInput,
					async (input, run) => json((await this.runCommand(input.id, input.args, run)).result)
				),
				taskOnly: true
			},
			this.tool(
				'skill',
				'Load guidance on a topic listed in the system prompt (html, edit, components, variables, commands, ...).',
				false,
				skillInput,
				(input) => this.skill(input.name)
			)
		];
	}

	/** The skills behind the general tools; feature plugins add their own. */
	skills(): AiSkill[] {
		return [
			{
				id: 'html',
				summary: 'how designs are written as HTML and CSS: what maps to what, sizing, limits',
				body: HTML_SKILL,
				inlineWith: 'write'
			},
			{
				id: 'edit',
				summary: 'the edit operations, with examples',
				body: EDIT_SKILL,
				inlineWith: 'edit'
			},
			{
				id: 'components',
				summary: 'the components of this file and how to place instances',
				body: () => this.componentsSkill()
			},
			{
				id: 'variables',
				summary: 'the variables of this file as CSS custom properties',
				body: () => this.variablesSkill()
			},
			{ id: 'styles', summary: 'the shared styles of this file', body: () => this.stylesSkill() },
			{
				id: 'commands',
				summary: 'app commands edit can run (align, boolean ops, flatten, ...)',
				body: () => this.commandsSkill()
			}
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
		return `${kept}\n<!-- truncated: read fewer layers or a smaller depth -->`;
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
		if (!node) throw new Error(`there is no layer ${id}; read shows what exists`);
		return node;
	}

	private componentNames(): Record<NodeId, string> {
		const names: Record<NodeId, string> = {};
		for (const node of this.env.document.query((candidate) => candidate.type === 'COMPONENT')) {
			names[node.id] = node.name;
		}
		return names;
	}

	private vectorSvg(id: NodeId): string | null {
		const node = this.env.document.get(id);
		if (node === undefined || !VECTOR_TYPES.has(node.type)) return null;
		try {
			const { headlessRenderer } = this.env;
			const { source, geometry } = headlessRenderer.scene();
			const area = headlessRenderer.exportArea(id, true);
			return serializeSvg(source, geometry, id, { area, scale: 1, includeIds: false }).svg;
		} catch {
			return null;
		}
	}

	private html(ids: readonly NodeId[], depth: number): string {
		return serializeHtml(this.source(), ids, {
			depth,
			cssNames: variableCss(this.env.variables).names,
			componentNames: this.componentNames(),
			vectorSvg: (id) => this.vectorSvg(id)
		});
	}

	// ---------- read ----------

	private header(): string {
		const { document, selection } = this.env;
		const page = document.currentPage;
		const parts = [`page "${page.name}" (${page.id})`];
		const pages = document.reader.pages();
		if (pages.length > 1)
			parts.push(`pages: ${pages.map((other) => `"${other.name}"`).join(', ')}`);
		if (selection.ids.length > 0) parts.push(`selection: ${selection.ids.join(', ')}`);
		else parts.push('nothing selected');
		return `<!-- ${parts.join(' · ')} -->`;
	}

	private read(input: z.infer<typeof readInput>): string {
		const { document, selection } = this.env;
		if (input.find !== undefined) return this.find(input.find);
		let ids = input.ids;
		let depth = input.depth ?? READ_DEPTH;
		if (ids === undefined && selection.ids.length > 0) ids = [...selection.ids];
		if (ids === undefined) {
			ids = [...document.children(document.currentPageId)];
			depth = input.depth ?? OVERVIEW_DEPTH;
		}
		for (const id of ids) this.requireNode(id);
		if (ids.length === 0) return `${this.header()}\n<!-- the page is empty -->`;
		return this.limited(`${this.header()}\n${this.html(ids, depth)}`);
	}

	private find(needle: string): string {
		const { document } = this.env;
		const lower = needle.toLowerCase();
		const matches = document.query((node) => {
			if (node.name.toLowerCase().includes(lower)) return true;
			return node.type === 'TEXT' && plainText(node.paragraphs).toLowerCase().includes(lower);
		}, document.currentPageId);
		const shown = matches.slice(0, FIND_LIMIT).map((node) => node.id);
		let summary = `${matches.length} layers match "${needle}"`;
		if (matches.length > FIND_LIMIT) summary += `, first ${FIND_LIMIT} shown`;
		return this.limited(`<!-- ${summary} -->\n${this.html(shown, 0)}`);
	}

	// ---------- write ----------

	private services(): Parameters<typeof applyHtml>[0] {
		const { document, variables, htmlLayout } = this.env;
		return { document, variables, layout: htmlLayout };
	}

	private async write(input: z.infer<typeof writeInput>, run: AiRunInfo): Promise<string> {
		if (input.replace !== undefined && input.parentId !== undefined) {
			throw new Error('give either replace or parentId, not both');
		}
		let target: HtmlTarget = { kind: 'insert', parentId: input.parentId, position: input.position };
		if (input.replace !== undefined) {
			this.requireNode(input.replace);
			target = { kind: 'replace', id: input.replace };
		}
		if (input.parentId !== undefined) this.requireNode(input.parentId);
		const label = input.label ?? run.label;
		const result = await applyHtml(this.services(), input.html, target, {
			origin: 'ai',
			label,
			runId: run.id
		});
		this.countDeletions(run, result.removed.length);
		this.env.ai.reportEdit(run.id, {
			label,
			nodeIds: [...result.rootIds, ...result.changed, ...result.removed],
			changeCount: result.changeCount
		});
		return json({
			rootIds: result.rootIds,
			created: result.created.length,
			changed: result.changed.length,
			removed: result.removed.length,
			warnings: result.warnings
		});
	}

	/** Counts removals against the run's limit; throws (before applying) when over it. */
	private checkDeletions(run: AiRunInfo, count: number): void {
		const used = this.deletionsByRun.get(run.id) ?? 0;
		if (used + count > this.options.maxDeletionsPerRun) {
			throw new Error(
				`this run may remove at most ${this.options.maxDeletionsPerRun} layers; ask the user first`
			);
		}
	}

	private countDeletions(run: AiRunInfo, count: number): void {
		this.deletionsByRun.set(run.id, (this.deletionsByRun.get(run.id) ?? 0) + count);
	}

	// ---------- edit ----------

	private async edit(
		ops: EditOperation[],
		label: string | undefined,
		run: AiRunInfo
	): Promise<string> {
		const results: unknown[] = [];
		const nodeIds: NodeId[] = [];
		let changeCount = 0;
		const meta = { origin: 'ai' as const, label: label ?? run.label, runId: run.id };
		for (const [position, operation] of ops.entries()) {
			try {
				const outcome = await this.editOne(operation, meta, run);
				changeCount += outcome.changes;
				nodeIds.push(...outcome.ids);
				results.push(outcome.result);
			} catch (error) {
				let message = `op ${position + 1}: ${describeError(error)}`;
				if (position > 0) message += ` (ops 1-${position} were applied)`;
				throw new Error(message);
			}
		}
		if (changeCount > 0)
			this.env.ai.reportEdit(run.id, { label: meta.label, nodeIds, changeCount });
		return json(results);
	}

	private async editOne(
		operation: EditOperation,
		meta: { origin: 'ai'; label: string; runId: string },
		run: AiRunInfo
	): Promise<{ changes: number; ids: NodeId[]; result: unknown }> {
		const { document } = this.env;
		if ('delete' in operation) {
			const node = this.requireNode(operation.delete);
			if (node.type === 'PAGE') throw new Error('a page cannot be deleted here');
			this.checkDeletions(run, 1);
			const changes = document.apply(document.removeNode(node.id), meta).changes.length;
			this.countDeletions(run, 1);
			return { changes, ids: [node.id], result: { deleted: node.id } };
		}
		if ('move' in operation) {
			const node = this.requireNode(operation.move);
			if (node.type === 'PAGE') throw new Error('a page cannot be moved');
			this.requireNode(operation.parentId);
			const position = operation.position ?? document.children(operation.parentId).length;
			const changes = document.apply(document.moveNode(node.id, operation.parentId, position), meta)
				.changes.length;
			return { changes, ids: [node.id], result: { moved: node.id } };
		}
		if ('command' in operation) return this.runCommand(operation.command, operation.args, run);
		return this.editLayer(operation, meta);
	}

	private async editLayer(
		operation: { id: string; css?: string; text?: string; name?: string },
		meta: { origin: 'ai'; label: string; runId: string }
	): Promise<{ changes: number; ids: NodeId[]; result: unknown }> {
		const { document } = this.env;
		const node = this.requireNode(operation.id);
		let changes = 0;
		const props: Record<string, unknown> = {};
		if (operation.name !== undefined) props.name = operation.name;
		if (operation.text !== undefined) {
			if (node.type !== 'TEXT') throw new Error(`${node.id} is a ${node.type}, not a text layer`);
			props.paragraphs = paragraphsOf(operation.text, node.paragraphs[0]);
		}
		if (Object.keys(props).length > 0) {
			changes += document.apply(document.setProps(node.id, props), meta).changes.length;
		}
		const warnings: string[] = [];
		if (operation.css !== undefined && operation.css.trim() !== '') {
			if (node.type === 'PAGE') throw new Error('a page has no CSS; edit its layers');
			const html = patchRootStyle(this.html([node.id], 50), operation.css);
			const result = await applyHtml(this.services(), html, { kind: 'replace', id: node.id }, meta);
			changes += result.changeCount;
			warnings.push(...result.warnings);
		}
		const result: Record<string, unknown> = { edited: node.id };
		if (warnings.length > 0) result.warnings = warnings;
		return { changes, ids: [node.id], result };
	}

	private isBlockedCommand(id: string): boolean {
		return this.options.blockedCommandPrefixes.some((prefix) => id.startsWith(prefix));
	}

	private async runCommand(
		id: string,
		args: unknown,
		run: AiRunInfo
	): Promise<{ changes: number; ids: NodeId[]; result: unknown }> {
		const { commands, document, ai } = this.env;
		if (this.isBlockedCommand(id)) throw new Error(`command "${id}" is not available to the agent`);
		if (!commands.has(id))
			throw new Error(`unknown command "${id}"; the commands skill lists them`);
		if (!commands.isEnabled(id)) {
			throw new Error(`command "${id}" is disabled right now (nothing selected, or wrong context)`);
		}
		const before = document.revision;
		await ai.withRun(run, () => commands.run(id, args));
		const revisions = document.revision - before;
		return { changes: revisions, ids: [], result: { ran: id, documentChanged: revisions > 0 } };
	}

	// ---------- screenshot and skill ----------

	private screenshotTarget(id: string | undefined): NodeId {
		if (id !== undefined) return this.requireNode(id).id;
		const selected = this.env.selection.ids[0];
		if (selected !== undefined) return selected;
		const first = this.env.document.children(this.env.document.currentPageId)[0];
		if (first === undefined) throw new Error('the page is empty: there is nothing to show');
		return first;
	}

	private async screenshot(id: string | undefined, scale: number | undefined): Promise<string> {
		const target = this.screenshotTarget(id);
		const bounds = this.env.document.absoluteBounds(target);
		const longest = Math.max(bounds.width, bounds.height, 1);
		const fit = SCREENSHOT_LONGEST_SIDE / longest;
		const image = await this.env.headlessRenderer.exportNode(target, {
			scale: Math.min(scale ?? Math.min(1, fit), fit * 1.5),
			contentsOnly: false,
			format: 'PNG'
		});
		if (image.bytes.length > this.options.maxImageBytes) {
			throw new Error(
				`the image is ${image.bytes.length} bytes, over the limit; use a smaller scale`
			);
		}
		return json({
			width: image.width,
			height: image.height,
			mimeType: image.mimeType,
			base64: base64Of(image.bytes)
		});
	}

	private skill(name: string): string {
		const text = this.env.ai.skillText(name);
		if (text !== undefined) return text;
		const known = this.env.ai.skills.list().map((skill) => skill.id);
		throw new Error(`no skill "${name}"; there are: ${known.join(', ')}`);
	}

	private componentsSkill(): string {
		const components = this.env.document.query((node) => node.type === 'COMPONENT');
		if (components.length === 0) return 'This file has no components.';
		const lines = [
			'Place an instance with an element carrying data-component="<name>" (its own CSS sets size',
			'and position; its content comes from the component). Components of this file:',
			''
		];
		for (const node of components) {
			if (node.type !== 'COMPONENT') continue;
			let line = `- ${node.name} (${Math.round(node.width)}×${Math.round(node.height)})`;
			if (node.description !== '') line += `: ${node.description}`;
			lines.push(line);
		}
		return lines.join('\n');
	}

	private variablesSkill(): string {
		const { variables } = this.env;
		const css = variableCss(variables);
		const entries = variables.variables();
		if (entries.length === 0) return 'This file has no variables.';
		const lines = [
			'Variables are CSS custom properties: write var(--name) and the layer is bound to the',
			'variable (colors, gap, padding, border-radius, width, height, opacity). Values are in the',
			'default modes.',
			''
		];
		for (const variable of entries) {
			const name = css.names[variable.id];
			lines.push(
				`- ${name}: ${css.values[name] ?? '(no value)'}  (${variable.name}, ${variable.resolvedType})`
			);
		}
		return lines.join('\n');
	}

	private stylesSkill(): string {
		const styles = this.env.document.entities('style');
		if (styles.length === 0) return 'This file has no shared styles.';
		return styles.map((style) => `- ${style.name} (${style.type})`).join('\n');
	}

	private commandsSkill(): string {
		const { commands } = this.env;
		const lines = [
			'Run one with edit: { "command": "<id>" }. Commands act on the current selection.',
			''
		];
		for (const command of commands.list()) {
			if (this.isBlockedCommand(command.id)) continue;
			let line = `- ${command.id}: ${command.title}`;
			if (!commands.isEnabled(command.id)) line += ' (disabled now)';
			lines.push(line);
		}
		return lines.join('\n');
	}
}

/** `html` with `css` declarations added to its first element's inline style (later ones win). */
export function patchRootStyle(html: string, css: string): string {
	const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	const root = parsed.body.firstElementChild;
	if (root === null || !(root instanceof HTMLElement || root instanceof SVGElement)) return html;
	root.style.cssText = `${root.style.cssText};${css}`;
	return parsed.body.innerHTML;
}

const HTML_SKILL = `# Writing designs as HTML

Every layer is an element; data-id names it, data-name is the layer name.

| HTML / CSS | Layer |
| --- | --- |
| <div> | frame |
| display:flex (+ flex-direction, gap, padding, justify-content, align-items, flex-wrap) | auto layout |
| <div> with neither children nor text | rectangle (ellipse when fully round) |
| <p>, <span>, <h1>… holding only text and inline elements | text layer; inline <span>/<b>/<i> become styled runs |
| text in an element with background, border or padding (a button) | frame with auto layout around a text layer |
| inline <svg> | vector layers |
| data-component="Name" | instance of that component (see the components skill) |
| var(--name) | bound to that variable (see the variables skill) |

Sizing per axis: a fixed width/height stays fixed; content-sized (no width, fit-content, nowrap
text) hugs; flex: 1 on the main axis or align-self: stretch fills the parent.

Carried over: background (colours, linear and radial gradients), border (per side, dashed),
border-radius (per corner), box-shadow (inset too), filter: blur(), backdrop-filter: blur(),
opacity, mix-blend-mode, overflow: hidden (clips), font-family/size/weight/style, line-height,
letter-spacing, text-transform, text-decoration, text-align, color, min/max sizes.

Write it so it stays editable:
- Use flexbox with gap for every group of children. Margins between flex items are dropped;
  block children are only turned into auto layout when their spacing is even.
- Give the root an explicit width (e.g. 1440px for a desktop page, 390px for mobile).
- position: absolute with left/top places a child freely inside its parent.
- Inline styles or one <style> element. No scripts, external CSS, web fonts, images or Tailwind:
  images become grey placeholders, CSS grid and transforms are approximated.
- The answer of write lists warnings for anything that was not carried over; fix and rewrite.

Rewriting: write with replace="<data-id>" and one root element. Keep the data-id of every
element that should stay the same layer; elements without one are new layers, and layers whose
data-id is gone are removed (hidden ones, display:none, are kept).`;

const EDIT_SKILL = `# edit

One call, several operations, applied in order:

{ "ops": [
  { "id": "<data-id>", "css": "gap: 16px; background: #f4f4f5" },
  { "id": "<data-id>", "text": "New label" },
  { "id": "<data-id>", "name": "Header" },
  { "delete": "<data-id>" },
  { "move": "<data-id>", "parentId": "<data-id>", "position": 0 },
  { "command": "<command id>" }
] }

css sets declarations on that one layer (same vocabulary as write); its children stay.
text replaces a text layer's text, keeping its style. For bigger changes, rewrite the layer with
write and replace. Commands act on the current selection (see the commands skill).`;
