// The object installed as `window.__design_debug`: a programmatic window into app state for
// `bun run qa` (the canvas is pixels, not DOM). Everything optional is a typed seam: the
// services that do not exist yet (document, selection, viewport, history) appear on the
// surface as soon as their plugin is provided, and `summary()` fills its fields from them.
//
// Services are read structurally (`readString(document, 'currentPageId')`), not through their
// types, because this plugin deliberately depends on none of them.

import { FiberState, type Context, type Fiber } from '@neoworks/extension-system';
import type { BootReport } from '../../lib/kernel/boot.svelte';

/** Services the surface exposes when they exist, under these exact names. */
export const DEBUG_SERVICE_NAMES = [
	'regions',
	'commands',
	'keymap',
	'contextKeys',
	'desktop',
	'fonts',
	'menus',
	'panels',
	'inspectors',
	'tools',
	'document',
	'selection',
	'viewport',
	'history',
	'renderer',
	'overlay',
	'snapping',
	'spatial'
] as const;
export type DebugServiceName = (typeof DEBUG_SERVICE_NAMES)[number];

export interface PluginDebugInfo {
	name: string;
	state: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading';
	error?: string;
}

export interface DebugSummary {
	/** Current page id, or null while no document service exists. */
	page: string | null;
	selection: string[];
	/** Id of the active tool, or null while no tools service exists. */
	tool: string | null;
	zoom: number | null;
	nodeCount: number | null;
	/** `name: error` for every failed plugin fiber. */
	failed: string[];
	/** Names of the services currently exposed on the surface. */
	services: string[];
}

export interface DesignDebug {
	summary(): DebugSummary;
	/** The root kernel context: `ctx.fiber.getEffects()` is the labelled effect tree. */
	ctx: Context;
	/** Every plugin fiber with its state and error, from live fibers and the boot report. */
	plugins(): PluginDebugInfo[];
	/** The live services, by name; absent until their plugin is active. */
	document?: unknown;
	selection?: unknown;
	viewport?: unknown;
	history?: unknown;
	[service: string]: unknown;
}

export interface SurfaceSources {
	/** The boot report, once the kernel finished booting. */
	bootReport(): BootReport | undefined;
}

const STATE_NAMES: Record<FiberState, PluginDebugInfo['state']> = {
	[FiberState.PENDING]: 'pending',
	[FiberState.LOADING]: 'loading',
	[FiberState.ACTIVE]: 'active',
	[FiberState.FAILED]: 'failed',
	[FiberState.DISPOSED]: 'disposed',
	[FiberState.UNLOADING]: 'unloading'
};

function readProperty(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined;
	return Reflect.get(value, key);
}

function readString(value: unknown, key: string): string | null {
	const read = readProperty(value, key);
	if (typeof read === 'string') return read;
	return null;
}

function readNumber(value: unknown, key: string): number | null {
	const read = readProperty(value, key);
	if (typeof read === 'number' && Number.isFinite(read)) return read;
	return null;
}

function callString(value: unknown, method: string): string | null {
	const read = readProperty(value, method);
	if (typeof read !== 'function') return null;
	const result: unknown = Reflect.apply(read, value, []);
	if (typeof result === 'string') return result;
	return null;
}

function selectionIds(selection: unknown): string[] {
	const ids = readProperty(selection, 'ids');
	if (!Array.isArray(ids)) return [];
	return ids.filter((id): id is string => typeof id === 'string');
}

function countNodes(document: unknown): number | null {
	const snapshot = readProperty(document, 'snapshot');
	const nodes = readProperty(snapshot, 'nodes');
	if (typeof nodes !== 'object' || nodes === null) return null;
	return Object.keys(nodes).length;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function liveFibers(root: Context): { name: string; fiber: Fiber }[] {
	const found: { name: string; fiber: Fiber }[] = [];
	for (const runtime of root.registry.values()) {
		const name = runtime.name ? runtime.name : 'anonymous';
		for (const fiber of runtime.fibers) found.push({ name, fiber });
	}
	return found;
}

// Fiber keeps the error that failed it in a private field and has no accessor; the boot report
// has the message for boot-time failures, this covers a fiber that failed later (a retry).
function fiberError(fiber: Fiber): string | undefined {
	const error: unknown = Reflect.get(fiber, '_error');
	if (error === undefined || error === null) return undefined;
	return describeError(error);
}

export function createSurface(root: Context, sources: SurfaceSources): DesignDebug {
	const surface: DesignDebug = {
		ctx: root,
		plugins: () => collectPlugins(root, sources.bootReport()),
		summary: () => summarize(surface, collectPlugins(root, sources.bootReport()))
	};
	return surface;
}

function collectPlugins(root: Context, report: BootReport | undefined): PluginDebugInfo[] {
	const infos: PluginDebugInfo[] = liveFibers(root).map(({ name, fiber }) => {
		const info: PluginDebugInfo = { name, state: STATE_NAMES[fiber.state] };
		if (fiber.state === FiberState.FAILED) {
			info.error = fiberError(fiber);
		}
		return info;
	});
	for (const record of report?.records ?? []) {
		const info = infos.find((candidate) => candidate.name === record.name);
		if (info && info.error === undefined && record.error !== undefined) info.error = record.error;
		if (!info) infos.push({ name: record.name, state: record.status, error: record.error });
	}
	return infos;
}

function summarize(surface: DesignDebug, plugins: PluginDebugInfo[]): DebugSummary {
	const { document, selection, tools, viewport } = surface;
	return {
		page: readString(document, 'currentPageId'),
		selection: selectionIds(selection),
		tool: callString(tools, 'activeId'),
		zoom: readNumber(viewport, 'zoom'),
		nodeCount: countNodes(document),
		failed: plugins
			.filter((plugin) => plugin.state === 'failed')
			.map((plugin) => `${plugin.name}: ${plugin.error ?? 'unknown error'}`),
		services: DEBUG_SERVICE_NAMES.filter((name) => surface[name] !== undefined)
	};
}
