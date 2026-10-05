import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAiMain, type FakeScript, type FakeTurn } from '../../lib/ai/fakeMain';
import type { AiRun } from '../../lib/ai/types';
import { AiRevertError } from '../../lib/services/aiHistory';
import type { ApplyMeta, Transaction } from '../../lib/document';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import ai from '../ai';
import aiTools from '../ai-tools';
import desktopBridge from '../desktop-bridge';
import variablesCore from '../variables-core';
import aiHistory from './index';

const fakeHeadlessRenderer: Plugin = {
	name: 'headless-renderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', { exportNode: () => Promise.reject(new Error('unused')) });
	}
};

function providers(): Plugin[] {
	return [
		...editingProviders(),
		desktopBridge,
		variablesCore,
		fakeHeadlessRenderer,
		fakeOverlay,
		ai,
		aiTools
	];
}

interface Setup {
	mounted: MountedPlugin;
	ctx: Context;
	main: FakeAiMain;
}

let current: MountedPlugin | undefined;

afterEach(async () => {
	await current?.cleanup();
	current = undefined;
});

async function setup(script: FakeScript = () => Promise.resolve()): Promise<Setup> {
	let push: (channel: never, payload: never) => void = () => {};
	const main = new FakeAiMain((channel, payload) => push(channel as never, payload as never));
	main.script = script;
	const mounted = await mountPlugin(aiHistory, {
		providers: providers(),
		desktop: { ai: main.section }
	});
	const desktop = mounted.desktop;
	if (!desktop) throw new Error('no fake desktop');
	push = desktop.emit as typeof push;
	current = mounted;
	mounted.ctx.ai.grantConsent(mounted.ctx.document.documentId);
	return { mounted, ctx: mounted.ctx, main };
}

function createOps(count: number, prefix = 'Card'): unknown[] {
	return Array.from({ length: count }, (_, position) => ({
		op: 'create',
		type: 'RECTANGLE',
		props: { name: `${prefix} ${position + 1}`, x: position * 12, width: 10, height: 10 }
	}));
}

async function applyChanges(turn: FakeTurn, ops: unknown[]): Promise<void> {
	const result = await turn.callTool('apply_changes', { ops });
	if (!result.ok) throw new Error(result.text);
}

function namedLike(ctx: Context, prefix: string): number {
	return ctx.document.query((node) => node.name.startsWith(prefix)).length;
}

async function runToEnd(ctx: Context, prompt: string): Promise<AiRun> {
	const run = ctx.ai.run(prompt);
	await run.finished;
	return run;
}

describePlugin('ai-history', aiHistory, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.aiHistory.audits()).toEqual([]);
		expect(ctx.commands.has('ai.revert-last-run')).toBe(true);
		expect(ctx.commands.has('ai.toggle-run-highlight')).toBe(true);
	}
});

describe('one run is one undo step', () => {
	it('undoes a run with 20 changes in one step and redoes it', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(20)));
		const before = ctx.history.entries.length;
		const run = await runToEnd(ctx, 'Add twenty cards');
		expect(namedLike(ctx, 'Card')).toBe(20);
		expect(ctx.history.entries).toHaveLength(before + 1);
		expect(ctx.history.entries.at(-1)).toMatchObject({
			label: 'Add twenty cards',
			origin: 'ai',
			runId: run.id
		});
		expect(ctx.history.undo()).toBe(true);
		expect(namedLike(ctx, 'Card')).toBe(0);
		expect(ctx.history.redo()).toBe(true);
		expect(namedLike(ctx, 'Card')).toBe(20);
	});

	it('folds several tool calls of one run into the same step', async () => {
		const { ctx } = await setup(async (turn) => {
			await applyChanges(turn, createOps(2, 'A'));
			await applyChanges(turn, createOps(2, 'B'));
			await applyChanges(turn, createOps(2, 'C'));
		});
		const before = ctx.history.entries.length;
		await runToEnd(ctx, 'Three batches');
		expect(ctx.history.entries).toHaveLength(before + 1);
		expect(ctx.history.entries.at(-1)?.transactionCount).toBe(3);
		ctx.history.undo();
		expect(namedLike(ctx, 'A ') + namedLike(ctx, 'B ') + namedLike(ctx, 'C ')).toBe(0);
	});

	it('keeps undo locked while the run is open and unlocks it when the run ends', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { ctx } = await setup(async (turn) => {
			await applyChanges(turn, createOps(1));
			await gate;
		});
		const run = ctx.ai.run('Slow');
		await expect.poll(() => namedLike(ctx, 'Card')).toBe(1);
		expect(ctx.history.canUndo).toBe(false);
		release();
		await run.finished;
		expect(ctx.history.canUndo).toBe(true);
	});

	it('closes the group when the run is cancelled and keeps what it applied as one step', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { ctx } = await setup(async (turn) => {
			await applyChanges(turn, createOps(3));
			await gate;
		});
		const before = ctx.history.entries.length;
		const run = ctx.ai.run('Cancelled work');
		await expect.poll(() => namedLike(ctx, 'Card')).toBe(3);
		await run.cancel();
		release();
		expect(await run.finished).toBe('cancelled');
		expect(ctx.history.entries).toHaveLength(before + 1);
		expect(ctx.aiHistory.auditOf(run.id)?.status).toBe('cancelled');
	});

	it('leaves a run without writes out of history and the audit trail', async () => {
		const { ctx } = await setup((turn) => turn.callTool('read_tree', {}).then(() => undefined));
		const before = ctx.history.entries.length;
		await runToEnd(ctx, 'Just look');
		expect(ctx.history.entries).toHaveLength(before);
		expect(ctx.aiHistory.audits()).toEqual([]);
	});
});

describe('attribution', () => {
	it('tags every transaction of a run with origin ai and the run id', async () => {
		const { ctx } = await setup(async (turn) => {
			await applyChanges(turn, createOps(1, 'A'));
			await applyChanges(turn, createOps(1, 'B'));
		});
		const transactions: Transaction[] = [];
		const metas: ApplyMeta[] = [];
		ctx.on('document/change', (event) => {
			transactions.push(event.transaction);
			metas.push(event.meta);
		});
		const run = await runToEnd(ctx, 'Tag me');
		expect(transactions).toHaveLength(2);
		for (const transaction of transactions) {
			expect(transaction.origin).toBe('ai');
			expect(transaction.runId).toBe(run.id);
		}
		expect(metas.every((meta) => meta.runId === run.id)).toBe(true);
	});

	it('does not tag a user edit made after the run', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(1)));
		await runToEnd(ctx, 'Add one');
		const edit = ctx.document.apply(ctx.document.setProps('loose', { name: 'Mine' }), {
			origin: 'user',
			label: 'Rename'
		});
		expect(edit.origin).toBe('user');
		expect(edit.runId).toBeUndefined();
	});

	it('attributes the changes of a command the agent runs to the run, in the same step', async () => {
		const { ctx } = await setup(async (turn) => {
			await applyChanges(turn, createOps(1));
			const result = await turn.callTool('run_command', { id: 'test.rename-loose' });
			if (!result.ok) throw new Error(result.text);
		});
		const owner = ctx.commands;
		const dispose = owner.register({
			id: 'test.rename-loose',
			title: 'Rename loose',
			run: () => {
				ctx.document.apply(ctx.document.setProps('loose', { name: 'Renamed by command' }), {
					origin: 'user',
					label: 'Rename'
				});
			}
		});
		const origins: string[] = [];
		ctx.on('document/change', (event) => void origins.push(event.transaction.origin));
		const before = ctx.history.entries.length;
		await runToEnd(ctx, 'Use a command');
		dispose();
		expect(origins).toEqual(['ai', 'ai']);
		expect(ctx.document.require('loose').name).toBe('Renamed by command');
		expect(ctx.history.entries).toHaveLength(before + 1);
		ctx.history.undo();
		expect(ctx.document.require('loose').name).toBe('loose');
	});
});

describe('audit trail', () => {
	it('lists what a run changed and where its step is', async () => {
		const { ctx } = await setup(async (turn) => {
			await applyChanges(turn, createOps(2));
			await turn.callTool('set_props', { ids: ['loose'], props: { name: 'Edited by AI' } });
		});
		const run = await runToEnd(ctx, 'Add and rename');
		const audit = ctx.aiHistory.auditOf(run.id);
		expect(audit).toMatchObject({
			runId: run.id,
			label: 'Add and rename',
			status: 'done',
			transactionCount: 2,
			changeCount: 3
		});
		expect(audit?.nodeIds).toHaveLength(3);
		expect(audit?.nodeIds).toContain('loose');
		expect(ctx.aiHistory.stateOf(run.id)).toBe('applied');
		ctx.history.undo();
		expect(ctx.aiHistory.stateOf(run.id)).toBe('undone');
		ctx.history.redo();
		expect(ctx.aiHistory.stateOf(run.id)).toBe('applied');
	});

	it('is dropped when the document is replaced', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(1)));
		await runToEnd(ctx, 'One');
		ctx.document.replaceDocument(ctx.document.snapshot);
		expect(ctx.aiHistory.audits()).toEqual([]);
	});
});

describe('revert', () => {
	it('undoes the newest run through the undo stack', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(4)));
		const run = await runToEnd(ctx, 'Four cards');
		expect(ctx.aiHistory.canRevert(run.id)).toBe(true);
		ctx.aiHistory.revertRun(run.id);
		expect(namedLike(ctx, 'Card')).toBe(0);
		expect(ctx.aiHistory.stateOf(run.id)).toBe('undone');
		expect(ctx.aiHistory.canRevert(run.id)).toBe(false);
	});

	it('reverts an older run by applying its inverse, after later user edits', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(2)));
		const run = await runToEnd(ctx, 'Two cards');
		ctx.document.apply(ctx.document.setProps('loose', { name: 'User edit' }), {
			origin: 'user',
			label: 'Rename'
		});
		ctx.aiHistory.revertRun(run.id);
		expect(namedLike(ctx, 'Card')).toBe(0);
		expect(ctx.document.require('loose').name).toBe('User edit');
		expect(ctx.aiHistory.stateOf(run.id)).toBe('reverted');
		expect(ctx.history.undoLabel).toBe('Revert "Two cards"');
		ctx.history.undo();
		expect(namedLike(ctx, 'Card')).toBe(2);
	});

	it('fails without changing anything when later edits no longer match', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(1)));
		const run = await runToEnd(ctx, 'One card');
		const created = ctx.aiHistory.auditOf(run.id)?.nodeIds[0];
		if (created === undefined) throw new Error('no node');
		ctx.document.apply(ctx.document.setProps(created, { name: 'Renamed by user' }), {
			origin: 'user',
			label: 'Rename'
		});
		ctx.document.apply(ctx.document.removeNode(created), { origin: 'user', label: 'Delete' });
		const revision = ctx.document.revision;
		expect(() => ctx.aiHistory.revertRun(run.id)).toThrow(AiRevertError);
		expect(ctx.document.revision).toBe(revision);
	});

	it('revertLastRun picks the newest applied run, and says when there is none', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(1)));
		expect(ctx.aiHistory.revertLastRun()).toBe(false);
		await runToEnd(ctx, 'First');
		await runToEnd(ctx, 'Second');
		expect(namedLike(ctx, 'Card')).toBe(2);
		expect(ctx.aiHistory.revertLastRun()).toBe(true);
		expect(namedLike(ctx, 'Card')).toBe(1);
		await ctx.commands.run('ai.revert-last-run');
		expect(namedLike(ctx, 'Card')).toBe(0);
	});
});

describe('highlight', () => {
	it('marks the nodes of the last run and clears on a user edit', async () => {
		const { ctx } = await setup((turn) => applyChanges(turn, createOps(2)));
		const run = await runToEnd(ctx, 'Two');
		expect(ctx.aiHistory.highlightedIds).toEqual(ctx.aiHistory.auditOf(run.id)?.nodeIds);
		await ctx.commands.run('ai.toggle-run-highlight');
		expect(ctx.aiHistory.highlightedIds).toEqual([]);
		await ctx.commands.run('ai.toggle-run-highlight');
		expect(ctx.aiHistory.highlightedIds).toHaveLength(2);
		ctx.document.apply(ctx.document.setProps('loose', { name: 'x' }), {
			origin: 'user',
			label: 'Rename'
		});
		expect(ctx.aiHistory.highlightedIds).toEqual([]);
	});

	it('registers an overlay contribution while mounted', async () => {
		const { ctx } = await setup();
		expect(ctx.overlay.registry.has('ai-history/highlight')).toBe(true);
	});
});
