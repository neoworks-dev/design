// Lazy stubs: what a manifest's `contributes` becomes before the plugin's worker runs.
//
// Every entry is registered through the same service a built-in plugin would use (`commands`,
// `menus`, `keymap`, `tools`, `ai`), so menus, the palette and the keymap treat plugin commands
// like any other. The only difference is the `run`: it asks the plugin host to start the worker
// (once) and forwards the call to it. The stubs belong to the plugin's own fiber, so unloading the
// plugin removes them.
//
// A contributor declares which services it needs; the plugin's fiber injects exactly the union of
// those for the contributions its manifest uses, so a plugin that only adds a command does not wait
// for the AI service. Panels and inspectors need `pluginUi` (plugin `plugin-ui`), which renders
// the plugin's surface into them.

import type { Context } from '@neoworks/extension-system';
import PuzzlePieceIcon from 'phosphor-svelte/lib/PuzzlePieceIcon';
import type { AiToolHandler } from '../ai/types';
import type { InspectorSelection } from '../inspectors/selection';
import type { ToolContribution } from '../registries/tools.svelte';
import type { ToolKeyEvent, ToolPointerEvent } from '../tools/protocol';
import SurfaceView from './ui/SurfaceView.svelte';
import { AsyncCodegenCache, pluginCodegenProvider } from './api/asyncCodegen.svelte';
import type { PluginManifest } from './manifest';
import type { PluginRecord, PluginRuntime } from './types';

/** A record whose manifest is known to be valid. */
export type LoadablePluginRecord = PluginRecord & { manifest: PluginManifest };

export interface StubContributor {
	/** Services the contributor reads from `ctx`; the plugin's fiber injects them. */
	needs: readonly string[];
	applies(manifest: PluginManifest): boolean;
	contribute(ctx: Context, record: LoadablePluginRecord): void;
}

function commandStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const command of record.manifest.contributes.commands) {
		ctx.effect(
			() =>
				ctx.commands.register({
					id: command.id,
					title: command.title,
					when: command.when,
					run: (args) =>
						ctx.pluginRegistry.runtimeFor(pluginId).runCommand(pluginId, command.id, args)
				}),
			`plugin ${pluginId} command ${command.id}`
		);
	}
}

function menuStubs(ctx: Context, record: LoadablePluginRecord): void {
	for (const entry of record.manifest.contributes.menus) {
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: entry.menu,
					item: {
						id: entry.id,
						command: entry.command,
						title: entry.title,
						group: entry.group,
						order: entry.order,
						when: entry.when
					}
				}),
			`plugin ${record.manifest.id} menu ${entry.menu} ${entry.id}`
		);
	}
}

function keybindingStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const binding of record.manifest.contributes.keybindings) {
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: binding.key,
					command: binding.command,
					when: binding.when,
					scope: binding.scope,
					source: pluginId
				}),
			`plugin ${pluginId} key ${binding.key}`
		);
	}
}

function pointerPayload(toolId: string, phase: string, event: ToolPointerEvent): unknown {
	return {
		tool: toolId,
		phase,
		screen: event.screen,
		world: event.world,
		button: event.button,
		detail: event.detail,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey
	};
}

function keyPayload(toolId: string, event: ToolKeyEvent): unknown {
	return {
		tool: toolId,
		key: event.key,
		code: event.code,
		repeat: event.repeat,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey
	};
}

/**
 * A tool that forwards pointer and key events to the plugin's worker. Used for the lazy stub of a
 * manifest tool and for tools a plugin registers at run time; either way the first event starts
 * the worker.
 */
export function pluginToolContribution(
	pluginId: string,
	tool: { id: string; title: string; shortcut?: string; cursor?: string },
	runtime: () => PluginRuntime
): ToolContribution {
	return {
		id: tool.id,
		title: tool.title,
		icon: PuzzlePieceIcon,
		shortcut: tool.shortcut,
		cursor: tool.cursor,
		group: 'plugins',
		onActivate: () => runtime().notify(pluginId, 'tool.activate', { tool: tool.id }),
		onDeactivate: () => runtime().notify(pluginId, 'tool.deactivate', { tool: tool.id }),
		onPointerDown: (event) =>
			runtime().notify(pluginId, 'tool.pointer', pointerPayload(tool.id, 'down', event)),
		onPointerMove: (event) =>
			runtime().notify(pluginId, 'tool.pointer', pointerPayload(tool.id, 'move', event)),
		onPointerUp: (event) =>
			runtime().notify(pluginId, 'tool.pointer', pointerPayload(tool.id, 'up', event)),
		onKey: (event) => {
			runtime().notify(pluginId, 'tool.key', keyPayload(tool.id, event));
		}
	};
}

function toolStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const tool of record.manifest.contributes.tools) {
		ctx.effect(
			() =>
				ctx.tools.register(
					pluginToolContribution(pluginId, tool, () => ctx.pluginRegistry.runtimeFor(pluginId))
				),
			`plugin ${pluginId} tool ${tool.id}`
		);
	}
}

/** An AI tool whose function runs in the plugin's worker (started on the first call). */
export function pluginAiTool(
	pluginId: string,
	tool: {
		id: string;
		description: string;
		write: boolean;
		inputSchema: Record<string, unknown>;
	},
	runtime: () => PluginRuntime
): AiToolHandler {
	return {
		id: tool.id,
		description: tool.description,
		write: tool.write,
		inputSchema: tool.inputSchema,
		run: async (input) => {
			const answer = await runtime().call(pluginId, 'aiTool.run', { name: tool.id, input });
			if (typeof answer === 'string') return answer;
			return JSON.stringify(answer);
		}
	};
}

function aiToolStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const tool of record.manifest.contributes.aiTools) {
		ctx.effect(
			() =>
				ctx.ai.registerTool(
					pluginAiTool(pluginId, tool, () => ctx.pluginRegistry.runtimeFor(pluginId))
				),
			`plugin ${pluginId} ai tool ${tool.id}`
		);
	}
}

function codegenStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const language of record.manifest.contributes.codegen) {
		ctx.effect(
			() =>
				ctx.codegen.register(
					pluginCodegenProvider(language, new AsyncCodegenCache(), (input) =>
						ctx.pluginRegistry
							.runtimeFor(pluginId)
							.call(pluginId, 'codegen.generate', { id: language.id, input })
					)
				),
			`plugin ${pluginId} codegen ${language.id}`
		);
	}
}

/** Plugin tabs and inspector sections sort after the built-in ones unless the manifest says otherwise. */
const PLUGIN_ORDER = 100;

function panelStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const panel of record.manifest.contributes.panels) {
		let order = PLUGIN_ORDER;
		if (panel.order !== undefined) order = panel.order;
		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: panel.id,
					side: panel.side,
					title: panel.title,
					order,
					when: panel.when,
					shortcut: panel.shortcut,
					component: SurfaceView,
					props: { pluginId, surfaceId: panel.id }
				}),
			`plugin ${pluginId} panel ${panel.id}`
		);
	}
}

/** Whether an inspector section declared for `nodeTypes` shows for this selection. */
export function appliesToSelection(
	nodeTypes: readonly string[] | undefined,
	selection: InspectorSelection
): boolean {
	if (selection.count === 0) return false;
	if (nodeTypes === undefined) return true;
	return selection.kinds.every((kind) => nodeTypes.includes(kind));
}

function inspectorStubs(ctx: Context, record: LoadablePluginRecord): void {
	const pluginId = record.manifest.id;
	for (const inspector of record.manifest.contributes.inspectors) {
		let order = PLUGIN_ORDER;
		if (inspector.order !== undefined) order = inspector.order;
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: inspector.id,
					tab: inspector.tab,
					title: inspector.title,
					order,
					applies: (selection) => appliesToSelection(inspector.nodeTypes, selection),
					component: SurfaceView,
					props: { pluginId, surfaceId: inspector.id }
				}),
			`plugin ${pluginId} inspector ${inspector.id}`
		);
	}
}

export const STUB_CONTRIBUTORS: readonly StubContributor[] = [
	{
		needs: ['commands', 'pluginRegistry'],
		applies: (manifest) => manifest.contributes.commands.length > 0,
		contribute: commandStubs
	},
	{
		needs: ['menus'],
		applies: (manifest) => manifest.contributes.menus.length > 0,
		contribute: menuStubs
	},
	{
		needs: ['keymap'],
		applies: (manifest) => manifest.contributes.keybindings.length > 0,
		contribute: keybindingStubs
	},
	{
		needs: ['tools', 'pluginRegistry'],
		applies: (manifest) => manifest.contributes.tools.length > 0,
		contribute: toolStubs
	},
	{
		needs: ['ai', 'pluginRegistry'],
		applies: (manifest) => manifest.contributes.aiTools.length > 0,
		contribute: aiToolStubs
	},
	{
		needs: ['panels', 'pluginUi', 'pluginRegistry'],
		applies: (manifest) => manifest.contributes.panels.length > 0,
		contribute: panelStubs
	},
	{
		needs: ['inspectors', 'pluginUi', 'pluginRegistry'],
		applies: (manifest) => manifest.contributes.inspectors.length > 0,
		contribute: inspectorStubs
	},
	{
		needs: ['codegen', 'pluginRegistry'],
		applies: (manifest) => manifest.contributes.codegen.length > 0,
		contribute: codegenStubs
	}
];

/** The services a plugin's fiber must inject to register the stubs of `manifest`. */
export function stubNeeds(
	contributors: readonly StubContributor[],
	manifest: PluginManifest
): string[] {
	const needs = new Set<string>(['pluginRegistry']);
	for (const contributor of contributors) {
		if (!contributor.applies(manifest)) continue;
		for (const name of contributor.needs) needs.add(name);
	}
	return [...needs];
}
