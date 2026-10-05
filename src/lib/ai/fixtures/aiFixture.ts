// Test helpers for the AI feature plugins (review, rename, search, generate, palette, batch):
// the providers they all need (editing services, ai, ai-tools, ai-history, a fake headless
// renderer and overlay) and a scripted fake main that plays the agent.

import type { Context, Plugin } from '@neoworks/extension-system';
import type { DesignDocument } from '../../document';
import { editingProviders } from '../../editing/fixtures/editingFixture';
import { mountPlugin, type MountedPlugin } from '../../kernel/testing';
import { fakeOverlay } from '../../selecting/fixtures/selectionFixture';
import ai from '../../../plugins/ai';
import aiHistory from '../../../plugins/ai-history';
import aiTools from '../../../plugins/ai-tools';
import desktopBridge from '../../../plugins/desktop-bridge';
import variablesCore from '../../../plugins/variables-core';
import { taskOf, TASK_SCRIPTS } from '../../../../electron/ai/qaTasks';
import { text, type NodeSpec } from '../../document/fixtures';
import { FakeAiMain, type FakeScript, type FakeTurn } from '../fakeMain';

export const fakeHeadlessRenderer: Plugin = {
	name: 'headless-renderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {
			exportNode: () =>
				Promise.resolve({
					bytes: new Uint8Array([137, 80, 78, 71]),
					width: 10,
					height: 10,
					format: 'PNG',
					mimeType: 'image/png'
				})
		});
	}
};

/** Everything below the AI feature plugins: document, selection, commands, ai and its tools. */
export function aiProviders(extra: Plugin[] = [], document?: DesignDocument): Plugin[] {
	return [
		...editingProviders(document),
		desktopBridge,
		variablesCore,
		fakeHeadlessRenderer,
		fakeOverlay,
		ai,
		aiTools,
		aiHistory,
		...extra
	];
}

export interface AiSetup {
	mounted: MountedPlugin;
	ctx: Context;
	main: FakeAiMain;
}

/** Mount `plugin` over `aiProviders()`, with the fake agent playing `script`; consent granted. */
export async function setupAi(
	plugin: Plugin,
	script: FakeScript = () => Promise.resolve(),
	options: { providers?: Plugin[]; config?: unknown } = {}
): Promise<AiSetup> {
	let push: (channel: never, payload: never) => void = () => {};
	const main = new FakeAiMain((channel, payload) => push(channel as never, payload as never));
	main.script = script;
	let providers = options.providers;
	if (providers === undefined) providers = aiProviders();
	const mounted = await mountPlugin(plugin, {
		providers,
		desktop: { ai: main.section },
		config: options.config
	});
	const desktop = mounted.desktop;
	if (!desktop) throw new Error('no fake desktop');
	push = desktop.emit as typeof push;
	mounted.ctx.ai.grantConsent(mounted.ctx.document.documentId);
	return { mounted, ctx: mounted.ctx, main };
}

/** One `apply_changes` call that creates `count` rectangles named `<prefix> <n>`. */
export function createOps(count: number, prefix = 'Card'): unknown[] {
	return Array.from({ length: count }, (_, position) => ({
		op: 'create',
		type: 'RECTANGLE',
		props: { name: `${prefix} ${position + 1}`, x: position * 12, width: 10, height: 10 }
	}));
}

export async function applyChanges(turn: FakeTurn, ops: unknown[]): Promise<void> {
	const result = await turn.callTool('apply_changes', { ops });
	if (!result.ok) throw new Error(result.text);
}

/** The scripted QA agent's answer to the task named on the first line of the prompt. */
export function taskScript(): FakeScript {
	return async (turn) => {
		const task = taskOf(turn.prompt);
		if (task === undefined || TASK_SCRIPTS[task] === undefined) return;
		const events = TASK_SCRIPTS[task](turn.prompt, {
			call: (name, input) => turn.callTool(name, input)
		});
		for await (const event of events) turn.send(event);
	};
}

/** A text layer with these characters. */
export function textNode(id: string, name: string, characters: string): NodeSpec {
	return text({
		id,
		name,
		paragraphs: [{ runs: [{ text: characters, style: {} }], style: {} }]
	} as never);
}
