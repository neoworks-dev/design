// The namespaces of `design` for plugin API v1 (native): document, selection, viewport, commands,
// menus, tools, aiTools, codegen and undo. Each factory takes the `SdkEnv` and returns plain
// functions that call the host (`env.call('document.getNode', ...)`); the registration namespaces
// also answer the host's requests (`command.run`, `aiTool.run`, `codegen.generate`) and its tool
// events, keeping the plugin's handler functions here in the worker where they can run.
//
// Everything a plugin registers is undone when its worker stops: the host attaches the
// registrations to the plugin's fiber. `dispose()` on a returned handle removes one earlier.

import type { SdkEnv } from './design';
import type {
	AiToolRegistration,
	ApplyOptions,
	ApplyResult,
	CodegenBlockData,
	CodegenRegistration,
	CommandRegistration,
	MenuRegistration,
	NodeOperation,
	NodeQuery,
	PluginNode,
	ToolKeyMessage,
	ToolPointerMessage,
	ToolRegistration,
	ViewportInfo
} from '../api/types';

/** Returned by registrations; removes the registration again. */
export interface Disposable {
	dispose(): Promise<void>;
}

export interface DocumentApi {
	/** The node, or `null` when it does not exist. */
	getNode(id: string): Promise<PluginNode | null>;
	/** The children of a node in order; `null` lists the pages. */
	getChildren(id: string | null): Promise<PluginNode[]>;
	query(criteria?: NodeQuery): Promise<PluginNode[]>;
	currentPage(): Promise<PluginNode>;
	pages(): Promise<PluginNode[]>;
	/**
	 * Create, set, delete and move layers. Everything one plugin run applies is one undo step
	 * (unless `design.commitUndo()` splits it). All operations apply or none do.
	 */
	apply(operations: NodeOperation[], options?: ApplyOptions): Promise<ApplyResult>;
	/** Create one layer and answer its id. `props` use Figma-like names: x, y, width, fill, ... */
	createNode(
		type: Extract<NodeOperation, { op: 'create' }>['type'],
		props?: Record<string, unknown>,
		parentId?: string
	): Promise<string>;
	setProps(id: string, props: Record<string, unknown>): Promise<void>;
	remove(id: string): Promise<void>;
	/** Shared styles of the document (paint, text, effect, grid). */
	styles(): Promise<unknown[]>;
	/** Variable collections and variables of the document. */
	variables(): Promise<{ collections: unknown[]; variables: unknown[] }>;
	/**
	 * Refuse deleting these layers, by anyone, while the registration lives (the plugin's
	 * `before-delete` interception). Removed when the plugin stops.
	 */
	protect(ids: string[], reason: string): Promise<Disposable>;
}

export interface SelectionApi {
	/** The ids of the selected layers on the current page. */
	get(): Promise<string[]>;
	/** The selected layers themselves. */
	nodes(): Promise<PluginNode[]>;
	set(ids: string[]): Promise<void>;
}

export interface ViewportApi {
	get(): Promise<ViewportInfo>;
	/** Pan and zoom so the layers fill the canvas. */
	scrollAndZoomIntoView(ids: string[]): Promise<void>;
}

export type CommandHandler = (args: unknown) => unknown;

export interface CommandsApi {
	/**
	 * Register a command. The id starts with the plugin id; a command the manifest declares only
	 * gets its handler here, any other also appears in the palette with `title`.
	 */
	register(
		id: string,
		handler: CommandHandler,
		options?: Omit<CommandRegistration, 'id'>
	): Promise<Disposable>;
	/** Run any command of the app by id (needs the `document:write` permission). */
	run(id: string, args?: unknown): Promise<void>;
}

export interface MenusApi {
	register(registration: MenuRegistration): Promise<Disposable>;
}

export interface ToolHandlers {
	onActivate?(): void;
	onDeactivate?(): void;
	onPointer?(event: ToolPointerMessage): void;
	onKey?(event: ToolKeyMessage): void;
}

export interface ToolsApi {
	register(registration: ToolRegistration, handlers: ToolHandlers): Promise<Disposable>;
}

export type AiToolHandler = (input: unknown) => unknown;

export interface AiToolsApi {
	/** Offer a function to the AI agent; the answer is JSON-stringified unless it is a string. */
	register(registration: AiToolRegistration, handler: AiToolHandler): Promise<Disposable>;
}

export interface CodegenInputData {
	nodeId: string;
	node: PluginNode;
	options: { unit: 'px' | 'rem'; rootFontSize: number };
}

export type CodegenGenerate = (input: CodegenInputData) => CodegenBlockData[];

export interface CodegenApi {
	register(registration: CodegenRegistration, generate: CodegenGenerate): Promise<Disposable>;
}

function disposableOf(env: SdkEnv, answer: unknown, onDispose: () => void = () => {}): Disposable {
	const handle = readHandle(answer);
	let released = false;
	return {
		dispose: async () => {
			if (released) return;
			released = true;
			onDispose();
			await env.call('registrations.release', { handle });
		}
	};
}

function readHandle(answer: unknown): number {
	if (typeof answer === 'object' && answer !== null) {
		const handle: unknown = Reflect.get(answer, 'handle');
		if (typeof handle === 'number') return handle;
	}
	throw new Error('the host did not answer with a registration handle');
}

export function createDocumentApi(env: SdkEnv): DocumentApi {
	const apply = (operations: NodeOperation[], options?: ApplyOptions): Promise<ApplyResult> =>
		env.call<ApplyResult>('document.apply', { operations, options });
	return {
		getNode: (id) => env.call<PluginNode | null>('document.getNode', { id }),
		getChildren: (id) => env.call<PluginNode[]>('document.getChildren', { id }),
		query: (criteria = {}) => env.call<PluginNode[]>('document.query', criteria),
		currentPage: () => env.call<PluginNode>('document.currentPage'),
		pages: () => env.call<PluginNode[]>('document.pages'),
		apply,
		createNode: async (type, props, parentId) => {
			const result = await apply([{ op: 'create', type, parentId, props }]);
			return result.created[0].id;
		},
		setProps: async (id, props) => {
			await apply([{ op: 'set', id, props }]);
		},
		remove: async (id) => {
			await apply([{ op: 'delete', id }]);
		},
		styles: () => env.call<unknown[]>('document.styles'),
		variables: () =>
			env.call<{ collections: unknown[]; variables: unknown[] }>('document.variables'),
		protect: async (ids, reason) =>
			disposableOf(env, await env.call('document.protect', { ids, reason }))
	};
}

export function createSelectionApi(env: SdkEnv): SelectionApi {
	return {
		get: () => env.call<string[]>('selection.get'),
		nodes: () => env.call<PluginNode[]>('selection.nodes'),
		set: async (ids) => {
			await env.call('selection.set', { ids });
		}
	};
}

export function createViewportApi(env: SdkEnv): ViewportApi {
	return {
		get: () => env.call<ViewportInfo>('viewport.get'),
		scrollAndZoomIntoView: async (ids) => {
			await env.call('viewport.scrollAndZoomIntoView', { ids });
		}
	};
}

function field<Value = unknown>(source: unknown, key: string): Value | undefined {
	if (typeof source !== 'object' || source === null) return undefined;
	const found: Value | undefined = Reflect.get(source, key);
	return found;
}

function readString(source: unknown, key: string): string {
	const value = field(source, key);
	if (typeof value === 'string') return value;
	throw new Error(`"${key}" is required`);
}

export function createCommandsApi(env: SdkEnv): CommandsApi {
	const handlers = new Map<string, CommandHandler>();
	env.handle('command.run', async (params) => {
		const id = readString(params, 'id');
		const handler = handlers.get(id);
		if (handler === undefined) {
			if (env.fallbackCommand === undefined) {
				throw new Error(`the plugin registered no handler for "${id}"`);
			}
			await env.fallbackCommand(id, field(params, 'args'));
			return;
		}
		await handler(field(params, 'args'));
	});
	return {
		register: async (id, handler, options = {}) => {
			handlers.set(id, handler);
			const answer = await env.call('commands.register', { id, ...options });
			return disposableOf(env, answer, () => handlers.delete(id));
		},
		run: async (id, args) => {
			await env.call('commands.run', { id, args });
		}
	};
}

export function createMenusApi(env: SdkEnv): MenusApi {
	return {
		register: async (registration) =>
			disposableOf(env, await env.call('menus.register', registration))
	};
}

function isMessageFor<Message extends { tool: string }>(
	value: unknown,
	tool: string
): value is Message {
	return field(value, 'tool') === tool;
}

export function createToolsApi(env: SdkEnv): ToolsApi {
	return {
		register: async (registration, handlers) => {
			const mine = <Message extends { tool: string }>(
				listener: ((event: Message) => void) | undefined
			): ((payload: unknown) => void) => {
				return (payload) => {
					if (listener !== undefined && isMessageFor<Message>(payload, registration.id)) {
						listener(payload);
					}
				};
			};
			const onActivate = mine<{ tool: string }>(() => handlers.onActivate?.());
			const onDeactivate = mine<{ tool: string }>(() => handlers.onDeactivate?.());
			const onPointer = mine<ToolPointerMessage>((event) => handlers.onPointer?.(event));
			const onKey = mine<ToolKeyMessage>((event) => handlers.onKey?.(event));
			env.events.on('tool.activate', onActivate);
			env.events.on('tool.deactivate', onDeactivate);
			env.events.on('tool.pointer', onPointer);
			env.events.on('tool.key', onKey);
			const answer = await env.call('tools.register', registration);
			return disposableOf(env, answer, () => {
				env.events.off('tool.activate', onActivate);
				env.events.off('tool.deactivate', onDeactivate);
				env.events.off('tool.pointer', onPointer);
				env.events.off('tool.key', onKey);
			});
		}
	};
}

export function createAiToolsApi(env: SdkEnv): AiToolsApi {
	const handlers = new Map<string, AiToolHandler>();
	env.handle('aiTool.run', (params) => {
		const name = readString(params, 'name');
		const handler = handlers.get(name);
		if (handler === undefined) throw new Error(`the plugin registered no AI tool "${name}"`);
		return handler(field(params, 'input'));
	});
	return {
		register: async (registration, handler) => {
			handlers.set(registration.id, handler);
			const answer = await env.call('aiTools.register', registration);
			return disposableOf(env, answer, () => handlers.delete(registration.id));
		}
	};
}

export function createCodegenApi(env: SdkEnv): CodegenApi {
	const providers = new Map<string, CodegenGenerate>();
	env.handle('codegen.generate', (params) => {
		const id = readString(params, 'id');
		const generate = providers.get(id);
		if (generate === undefined)
			throw new Error(`the plugin registered no codegen provider "${id}"`);
		const input = field<CodegenInputData>(params, 'input');
		if (input === undefined) throw new Error('"input" is required');
		return generate(input);
	});
	return {
		register: async (registration, generate) => {
			providers.set(registration.id, generate);
			const answer = await env.call('codegen.register', registration);
			return disposableOf(env, answer, () => providers.delete(registration.id));
		}
	};
}
