import type { Context } from '@neoworks/extension-system';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import { CommandDisabledError, CommandVetoedError, UnknownCommandError } from './commands.svelte';

const providers = [coreContextKeys, coreCommands];

async function mountConsumer(): Promise<MountedPlugin> {
	const consumer = {
		name: 'consumer',
		inject: ['commands', 'contextKeys'],
		apply(): void {}
	};
	return mountPlugin(consumer, { providers });
}

describe('commands', () => {
	it('registers, runs and disposes a command', async () => {
		const mounted = await mountConsumer();
		const calls: unknown[] = [];
		const dispose = mounted.ctx.commands.register({
			id: 'test.run',
			title: 'Run',
			run: (args) => void calls.push(args)
		});
		await mounted.ctx.commands.run('test.run', { value: 1 });
		expect(calls).toEqual([{ value: 1 }]);
		expect(mounted.ctx.commands.list().map((command) => command.id)).toEqual(['test.run']);

		dispose();
		await expect(mounted.ctx.commands.run('test.run')).rejects.toBeInstanceOf(UnknownCommandError);
		await mounted.cleanup();
	});

	it('awaits asynchronous commands', async () => {
		const mounted = await mountConsumer();
		let finished = false;
		mounted.ctx.commands.register({
			id: 'test.async',
			title: 'Async',
			run: async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				finished = true;
			}
		});
		await mounted.ctx.commands.run('test.async');
		expect(finished).toBe(true);
		await mounted.cleanup();
	});

	it('gives a typed error for an unknown id', async () => {
		const mounted = await mountConsumer();
		const error = await mounted.ctx.commands.run('nope').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(UnknownCommandError);
		expect((error as UnknownCommandError).commandId).toBe('nope');
		await mounted.cleanup();
	});

	it('disables a command while its when expression is false', async () => {
		const mounted = await mountConsumer();
		const { commands, contextKeys } = mounted.ctx;
		let runs = 0;
		commands.register({
			id: 'test.sel',
			title: 'Sel',
			when: 'hasSelection',
			run: () => void runs++
		});
		expect(commands.isEnabled('test.sel')).toBe(false);
		await expect(commands.run('test.sel')).rejects.toBeInstanceOf(CommandDisabledError);
		expect(runs).toBe(0);

		const unset = contextKeys.set('hasSelection', true);
		expect(commands.isEnabled('test.sel')).toBe(true);
		await commands.run('test.sel');
		expect(runs).toBe(1);

		unset();
		expect(commands.isEnabled('test.sel')).toBe(false);
		await mounted.cleanup();
	});

	it('updates isEnabled reactively when a context key changes', async () => {
		const mounted = await mountConsumer();
		const { commands, contextKeys } = mounted.ctx;
		commands.register({ id: 'test.sel', title: 'Sel', when: 'kind == frame', run: () => {} });
		const seen: boolean[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(commands.isEnabled('test.sel'));
			});
		});
		flushSync();
		const clear = contextKeys.set('kind', 'frame');
		flushSync();
		contextKeys.set('kind', 'text');
		flushSync();
		clear();
		stop();
		expect(seen).toEqual([false, true, false]);
		await mounted.cleanup();
	});

	it('rejects a malformed when expression at registration', async () => {
		const mounted = await mountConsumer();
		expect(() =>
			mounted.ctx.commands.register({ id: 'bad', title: 'Bad', when: 'a &&', run: () => {} })
		).toThrow(/invalid when expression/);
		await mounted.cleanup();
	});

	it('disposes by identity: a stale disposer keeps the replacing command', async () => {
		const mounted = await mountConsumer();
		const { commands } = mounted.ctx;
		const disposeFirst = commands.register({ id: 'test.same', title: 'First', run: () => {} });
		commands.register({ id: 'test.same', title: 'Second', run: () => {} });
		disposeFirst();
		expect(commands.get('test.same')?.title).toBe('Second');
		await mounted.cleanup();
	});

	it('emits command/run before execution and command/error on failure', async () => {
		const mounted = await mountConsumer();
		const ctx = mounted.ctx;
		const { commands } = ctx;
		const log: string[] = [];
		ctx.on('command/run', (id) => void log.push(`run:${id}`));
		ctx.on('command/error', (id, _args, error) => {
			log.push(`error:${id}:${(error as Error).message}`);
		});
		commands.register({ id: 'test.ok', title: 'Ok', run: () => void log.push('executed') });
		commands.register({
			id: 'test.fail',
			title: 'Fail',
			run: () => {
				throw new Error('boom');
			}
		});
		await commands.run('test.ok');
		await expect(commands.run('test.fail')).rejects.toThrow('boom');
		await expect(commands.run('missing')).rejects.toBeInstanceOf(UnknownCommandError);
		expect(log).toEqual([
			'run:test.ok',
			'executed',
			'run:test.fail',
			'error:test.fail:boom',
			'error:missing:unknown command "missing"'
		]);
		await mounted.cleanup();
	});

	it('lets a command/before listener veto the run', async () => {
		const mounted = await mountConsumer();
		const ctx = mounted.ctx;
		const { commands } = ctx;
		let runs = 0;
		commands.register({ id: 'test.guarded', title: 'Guarded', run: () => void runs++ });
		const stop = ctx.on('command/before', (id) => {
			if (id === 'test.guarded') return 'read-only mode';
		});
		await expect(commands.run('test.guarded')).rejects.toBeInstanceOf(CommandVetoedError);
		expect(runs).toBe(0);

		stop();
		await commands.run('test.guarded');
		expect(runs).toBe(1);
		await mounted.cleanup();
	});
});

describePlugin('core-context-keys', coreContextKeys, {
	contributes: ({ ctx }) => {
		const dispose = ctx.contextKeys.set('probe', 1);
		expect(ctx.contextKeys.get('probe')).toBe(1);
		dispose();
		expect(ctx.contextKeys.get('probe')).toBeUndefined();
	}
});

describePlugin('core-commands', coreCommands, {
	providers: [coreContextKeys],
	contributes: ({ ctx }: { ctx: Context }) => {
		expect(ctx.commands.list()).toEqual([]);
		const dispose = ctx.commands.register({ id: 'probe', title: 'Probe', run: () => {} });
		expect(ctx.commands.has('probe')).toBe(true);
		dispose();
	}
});

describe('context keys', () => {
	it('dispose by identity: a stale disposer does not unset the newer value', async () => {
		const mounted = await mountPlugin(coreContextKeys);
		const { contextKeys } = mounted.ctx;
		const first = contextKeys.set('mode', 'a');
		contextKeys.set('mode', 'b');
		first();
		expect(contextKeys.get('mode')).toBe('b');
		await mounted.cleanup();
	});
});
