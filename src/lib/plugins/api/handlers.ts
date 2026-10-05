// The host side of plugin API v1: one function per namespace turns the services (document,
// selection, viewport, history, commands, menus, tools, ai, codegen) into the methods a worker can
// call. Every method names the permission it needs, parses its parameters with a strict schema and
// returns plain data.
//
// Writes go through `document.apply` (see operations.ts) tagged `origin: 'plugin'`; registrations
// are created on the plugin's worker fiber, so they disappear when the worker stops, while the
// document changes the plugin made stay (they are user data).

import type { Change, Node, NodeId } from '../../document';
import type { CommandsService } from '../../registries/commands.svelte';
import type { MenusService } from '../../registries/menus.svelte';
import type { ToolsService } from '../../registries/tools.svelte';
import type { AiService } from '../../services/ai';
import type { CodegenService } from '../../services/codegen';
import type { DocumentService } from '../../services/document';
import type { ApiNamespace, PluginHostService } from '../../services/pluginHost';
import type { SelectionService } from '../../services/selection';
import { AsyncCodegenCache, pluginCodegenProvider } from './asyncCodegen.svelte';
import { pluginAiTool, pluginToolContribution } from '../stubs';
import type { PluginConnection } from '../connection';
import { applyOperations } from './operations';
import { apiSchemas, parseParams } from './schemas';
import type { PluginUndo } from './undo';
import type { ViewportInfo } from './types';

/** The part of the `viewport` service the API uses (the library may not import plugins). */
export interface PluginViewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
	zoomToSelection(ids: readonly NodeId[]): boolean;
}

/** Which commands `design.commands.run` refuses. */
export interface PluginApiBlocklist {
	isBlockedCommand(id: string): boolean;
}

export interface ApiServices {
	document: DocumentService;
	selection: SelectionService;
	viewport: PluginViewport;
	commands: CommandsService;
	menus: MenusService;
	tools: ToolsService;
	ai: AiService;
	codegen: CodegenService;
	host: PluginHostService;
	undo: PluginUndo;
	blocklist: PluginApiBlocklist;
}

const DEFAULT_QUERY_LIMIT = 100;

function requirePrefix(id: string, prefix: string): void {
	if (id.startsWith(prefix)) return;
	throw new Error(`"${id}" must start with "${prefix}" (the plugin's id)`);
}

/** Registrations of one plugin by handle, so the worker can release one before it stops. */
export class RegistrationBook {
	private readonly books = new WeakMap<PluginConnection, Map<number, () => unknown>>();
	private counter = 0;

	add(connection: PluginConnection, release: () => unknown): { handle: number } {
		let book = this.books.get(connection);
		if (book === undefined) {
			book = new Map();
			this.books.set(connection, book);
		}
		this.counter += 1;
		book.set(this.counter, release);
		return { handle: this.counter };
	}

	release(connection: PluginConnection, handle: number): void {
		const book = this.books.get(connection);
		const release = book?.get(handle);
		if (release === undefined) return;
		book?.delete(handle);
		void release();
	}
}

function documentNamespace(services: ApiServices): ApiNamespace {
	const { document, undo } = services;
	const requireNode = (id: NodeId): Node => {
		const node = document.get(id);
		if (node === undefined) throw new Error(`node ${id} does not exist`);
		return node;
	};
	return {
		getNode: {
			permission: 'document:read',
			run: (_call, params) => {
				const { id } = parseParams(apiSchemas.nodeId, params);
				const node = document.get(id);
				if (node === undefined) return null;
				return node;
			}
		},
		getChildren: {
			permission: 'document:read',
			run: (_call, params) => {
				const { id } = parseParams(apiSchemas.children, params);
				if (id !== null) requireNode(id);
				return document.childNodes(id);
			}
		},
		query: {
			permission: 'document:read',
			run: (_call, params) => {
				const criteria = parseParams(apiSchemas.query, params);
				const rootId = criteria.rootId === undefined ? document.currentPageId : criteria.rootId;
				requireNode(rootId);
				const name = criteria.name?.toLowerCase();
				const limit = criteria.limit === undefined ? DEFAULT_QUERY_LIMIT : criteria.limit;
				const matches = document.query((node) => {
					if (criteria.type !== undefined && node.type !== criteria.type) return false;
					return name === undefined || node.name.toLowerCase().includes(name);
				}, rootId);
				return matches.slice(0, limit);
			}
		},
		currentPage: { permission: 'document:read', run: () => document.currentPage },
		pages: { permission: 'document:read', run: () => document.pages() },
		styles: { permission: 'document:read', run: () => document.entities('style') },
		variables: {
			permission: 'document:read',
			run: () => ({
				collections: document.entities('collection'),
				variables: document.entities('variable')
			})
		},
		apply: {
			permission: 'document:write',
			run: (call, params) => {
				const { operations, options } = parseParams(apiSchemas.apply, params);
				const run = call.run;
				let label = call.connection.manifest.name;
				if (run !== null) label = run.label;
				if (options?.label !== undefined) label = options.label;
				return applyOperations(document, operations, {
					origin: 'plugin',
					label,
					runId: undo.runIdFor(run)
				});
			}
		}
	};
}

/**
 * Plugins that ask to keep layers from being deleted. Checked when changes are about to apply
 * (the kernel's `document/before-apply` waterfall, which is synchronous: a worker cannot be asked
 * from there, so protection is declared up front).
 */
export class DeletionGuard {
	private readonly protections = new Set<{
		ids: ReadonlySet<NodeId>;
		reason: string;
		owner: string;
	}>();

	protect(owner: string, ids: readonly NodeId[], reason: string): () => void {
		const protection = { ids: new Set(ids), reason, owner };
		this.protections.add(protection);
		return () => {
			this.protections.delete(protection);
		};
	}

	/** Throws when `changes` delete a protected layer. */
	check(changes: readonly Change[]): void {
		for (const change of changes) {
			if (change.t !== 'del') continue;
			for (const protection of this.protections) {
				if (!protection.ids.has(change.node.id)) continue;
				throw new Error(`${protection.owner} protects "${change.node.name}": ${protection.reason}`);
			}
		}
	}

	get size(): number {
		return this.protections.size;
	}
}

function protectionMethods(
	services: ApiServices,
	book: RegistrationBook,
	guard: DeletionGuard
): ApiNamespace {
	void services;
	return {
		protect: {
			permission: 'document:write',
			run: (call, params) => {
				const { ids, reason } = parseParams(apiSchemas.protect, params);
				const dispose = call.context.effect(
					() => guard.protect(call.pluginId, ids, reason),
					`plugin ${call.pluginId} protects layers`
				);
				return book.add(call.connection, dispose);
			}
		}
	};
}

function selectionNamespace(services: ApiServices): ApiNamespace {
	const { selection, document } = services;
	return {
		get: { permission: 'selection', run: () => [...selection.ids] },
		nodes: { permission: 'selection', run: () => selection.nodes() },
		set: {
			permission: 'selection',
			run: (_call, params) => {
				const { ids } = parseParams(apiSchemas.ids, params);
				const missing = ids.filter((id) => !document.has(id));
				if (missing.length > 0) throw new Error(`no such node: ${missing.join(', ')}`);
				selection.select(ids);
			}
		}
	};
}

function viewportNamespace(services: ApiServices): ApiNamespace {
	const { viewport } = services;
	return {
		get: {
			permission: 'document:read',
			run: (): ViewportInfo => ({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
		},
		scrollAndZoomIntoView: {
			permission: 'document:read',
			run: (_call, params) => {
				const { ids } = parseParams(apiSchemas.ids, params);
				viewport.zoomToSelection(ids);
			}
		}
	};
}

function historyNamespace(services: ApiServices): ApiNamespace {
	return {
		commitUndo: {
			permission: 'document:write',
			run: (call) => services.undo.commit(call.run)
		}
	};
}

function commandsNamespace(services: ApiServices, book: RegistrationBook): ApiNamespace {
	const { commands, host, blocklist } = services;
	return {
		register: {
			run: (call, params) => {
				const registration = parseParams(apiSchemas.command, params);
				requirePrefix(registration.id, `${call.pluginId}.`);
				const declared = call.connection.manifest.contributes.commands.some(
					(command) => command.id === registration.id
				);
				// A command the manifest declares already has its stub; only its handler is new.
				if (declared) return book.add(call.connection, () => undefined);
				const title = registration.title === undefined ? registration.id : registration.title;
				const dispose = call.context.effect(
					() =>
						commands.register({
							id: registration.id,
							title,
							when: registration.when,
							run: (args) => host.runtime.runCommand(call.pluginId, registration.id, args)
						}),
					`plugin ${call.pluginId} command ${registration.id}`
				);
				return book.add(call.connection, dispose);
			}
		},
		run: {
			permission: 'document:write',
			run: async (_call, params) => {
				const { id, args } = parseParams(apiSchemas.runCommand, params);
				if (blocklist.isBlockedCommand(id))
					throw new Error(`command "${id}" is not available to plugins`);
				await commands.run(id, args);
			}
		}
	};
}

function menusNamespace(services: ApiServices, book: RegistrationBook): ApiNamespace {
	return {
		register: {
			run: (call, params) => {
				const registration = parseParams(apiSchemas.menu, params);
				requirePrefix(registration.id, `${call.pluginId}.`);
				const dispose = call.context.effect(
					() =>
						services.menus.register({
							menu: registration.menu,
							item: {
								id: registration.id,
								command: registration.command,
								title: registration.title,
								group: registration.group,
								order: registration.order,
								when: registration.when
							}
						}),
					`plugin ${call.pluginId} menu ${registration.menu} ${registration.id}`
				);
				return book.add(call.connection, dispose);
			}
		}
	};
}

function toolsNamespace(services: ApiServices, book: RegistrationBook): ApiNamespace {
	const { tools, host } = services;
	return {
		register: {
			permission: 'ui:tool',
			run: (call, params) => {
				const registration = parseParams(apiSchemas.tool, params);
				requirePrefix(registration.id, `${call.pluginId}.`);
				const declared = call.connection.manifest.contributes.tools.some(
					(tool) => tool.id === registration.id
				);
				if (declared) return book.add(call.connection, () => undefined);
				const dispose = call.context.effect(
					() =>
						tools.register(pluginToolContribution(call.pluginId, registration, () => host.runtime)),
					`plugin ${call.pluginId} tool ${registration.id}`
				);
				return book.add(call.connection, dispose);
			}
		}
	};
}

function aiToolsNamespace(services: ApiServices, book: RegistrationBook): ApiNamespace {
	const { ai, host } = services;
	return {
		register: {
			permission: 'ai',
			run: (call, params) => {
				const registration = parseParams(apiSchemas.aiTool, params);
				requirePrefix(registration.id, `${call.pluginId}_`);
				const declared = call.connection.manifest.contributes.aiTools.some(
					(tool) => tool.id === registration.id
				);
				if (declared) return book.add(call.connection, () => undefined);
				const dispose = call.context.effect(
					() =>
						ai.registerTool(
							pluginAiTool(
								call.pluginId,
								{
									id: registration.id,
									description: registration.description,
									write: registration.write === true,
									inputSchema:
										registration.inputSchema === undefined
											? { type: 'object', properties: {} }
											: registration.inputSchema
								},
								() => host.runtime
							)
						),
					`plugin ${call.pluginId} ai tool ${registration.id}`
				);
				return book.add(call.connection, dispose);
			}
		}
	};
}

function codegenNamespace(services: ApiServices, book: RegistrationBook): ApiNamespace {
	const { codegen, host } = services;
	return {
		register: {
			permission: 'document:read',
			run: (call, params) => {
				const registration = parseParams(apiSchemas.codegen, params);
				requirePrefix(registration.id, `${call.pluginId}.`);
				const declared = call.connection.manifest.contributes.codegen.some(
					(language) => language.id === registration.id
				);
				if (declared) return book.add(call.connection, () => undefined);
				const dispose = call.context.effect(
					() =>
						codegen.register(
							pluginCodegenProvider(registration, new AsyncCodegenCache(), (input) =>
								host.runtime.call(call.pluginId, 'codegen.generate', {
									id: registration.id,
									input
								})
							)
						),
					`plugin ${call.pluginId} codegen ${registration.id}`
				);
				return book.add(call.connection, dispose);
			}
		}
	};
}

function registrationsNamespace(book: RegistrationBook): ApiNamespace {
	return {
		release: (call, params) => {
			const { handle } = parseParams(apiSchemas.release, params);
			book.release(call.connection, handle);
		}
	};
}

/** The namespaces of plugin API v1, by name. */
export function createApiNamespaces(
	services: ApiServices,
	guard: DeletionGuard
): Record<string, ApiNamespace> {
	const book = new RegistrationBook();
	const document = documentNamespace(services);
	return {
		document: { ...document, ...protectionMethods(services, book, guard) },
		selection: selectionNamespace(services),
		viewport: viewportNamespace(services),
		history: historyNamespace(services),
		commands: commandsNamespace(services, book),
		menus: menusNamespace(services, book),
		tools: toolsNamespace(services, book),
		aiTools: aiToolsNamespace(services, book),
		codegen: codegenNamespace(services, book),
		registrations: registrationsNamespace(book)
	};
}
