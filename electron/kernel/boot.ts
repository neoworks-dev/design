// Boots the main kernel with the same discipline as the renderer: every plugin is mounted, the
// results are collected with `Promise.allSettled`, and a plugin that fails or never gets its
// dependencies is reported instead of taking the process down.

import {
	FiberState,
	Inject,
	type Context,
	type Fiber,
	type Plugin
} from '@neoworks/extension-system';
import type { BootReport } from '../bridge';

export interface PluginEntry {
	plugin: Plugin;
	config?: unknown;
}

interface Mounted {
	name: string;
	plugin: Plugin;
	fiber: Fiber & PromiseLike<Fiber>;
}

function pluginName(plugin: Plugin): string {
	if (plugin.name) return plugin.name;
	return 'anonymous';
}

function errorMessage(reason: unknown): string {
	if (reason instanceof Error) return reason.message;
	return String(reason);
}

function stateSignature(mounted: Mounted[]): string {
	return mounted.map((entry) => entry.fiber.state).join(',');
}

// A plugin waiting on a service becomes active only after its provider settles, which happens
// after the first `await`. Pass until nothing changes between two ticks.
async function waitUntilStable(mounted: Mounted[]): Promise<PromiseSettledResult<Fiber>[]> {
	let results = await Promise.allSettled(mounted.map((entry) => entry.fiber));
	let signature = stateSignature(mounted);
	for (;;) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		results = await Promise.allSettled(mounted.map((entry) => entry.fiber));
		const next = stateSignature(mounted);
		if (next === signature) return results;
		signature = next;
	}
}

function missingServices(root: Context, plugin: Plugin): string[] {
	const injected = Object.keys(Inject.resolve(plugin.inject));
	return injected.filter((name) => root.reflect.get(name) === undefined);
}

/**
 * Mount `entries` on `root` and report what happened. Never throws for a plugin failure; the
 * report is also published through `ctx.ipc` (when that service is up) for the renderer.
 */
export async function bootMainKernel(root: Context, entries: PluginEntry[]): Promise<BootReport> {
	const mounted: Mounted[] = entries.map((entry) => {
		const name = pluginName(entry.plugin);
		return { name, plugin: entry.plugin, fiber: root.plugin(entry.plugin, entry.config) };
	});
	const results = await waitUntilStable(mounted);

	const report: BootReport = { kernel: 'main', loaded: [], failed: [], pending: [] };
	mounted.forEach((entry, position) => {
		const result = results[position];
		if (result.status === 'rejected') {
			report.failed.push({ plugin: entry.name, message: errorMessage(result.reason) });
			return;
		}
		if (entry.fiber.state === FiberState.ACTIVE) {
			report.loaded.push(entry.name);
			return;
		}
		report.pending.push({ plugin: entry.name, missing: missingServices(root, entry.plugin) });
	});

	for (const failure of report.failed) {
		root.logger('boot').error(`plugin ${failure.plugin} failed: ${failure.message}`);
	}
	for (const pending of report.pending) {
		root
			.logger('boot')
			.warn(`plugin ${pending.plugin} is waiting for: ${pending.missing.join(', ')}`);
	}
	if (root.ipc) root.ipc.publishBootReport(report);
	return report;
}
