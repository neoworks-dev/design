// Commands: every user-invokable action is `{ id, title, run, when? }`. The palette, menus, the
// keymap and AI tools reference commands by id only.
//
// Provided by plugin `core-commands` as `ctx.commands`:
//
//   ctx.effect(
//   	() => ctx.commands.register({ id: 'layers.rename', title: 'Rename', run: renameSelection }),
//   	'rename command'
//   );
//   await ctx.commands.run('layers.rename');
//
// Ids are namespaced: bare names (`undo`, `select-all`) belong to core plugins, a plugin's own
// commands are prefixed with its id (`layers.rename`).
//
// Running a command goes through three kernel events (see lib/kernel/events.ts):
//   command/before  (bail)  a listener returns a reason string to veto the run
//   command/run     (emit)  the command is about to execute (telemetry, AI audit trail)
//   command/error   (emit)  unknown id, disabled, vetoed or thrown; `run` rejects with the same error

import { Service, type Context } from '@neoworks/extension-system';
import type { ContextKeysService } from './contextKeys.svelte';
import { Registry, type RegistryEntry } from './registry.svelte';

export interface Command extends RegistryEntry {
	title: string;
	/** Context-key expression (see whenExpression.ts). The command is disabled while false. */
	when?: string;
	run: (args?: unknown) => void | Promise<void>;
}

export class UnknownCommandError extends Error {
	constructor(readonly commandId: string) {
		super(`unknown command "${commandId}"`);
		this.name = 'UnknownCommandError';
	}
}

export class CommandDisabledError extends Error {
	constructor(
		readonly commandId: string,
		readonly when: string
	) {
		super(`command "${commandId}" is disabled (when: ${when})`);
		this.name = 'CommandDisabledError';
	}
}

export class CommandVetoedError extends Error {
	constructor(
		readonly commandId: string,
		readonly reason: string
	) {
		super(`command "${commandId}" was vetoed: ${reason}`);
		this.name = 'CommandVetoedError';
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		commands: CommandsService;
	}
}

export class CommandsService extends Service {
	readonly registry = new Registry<Command>();

	/**
	 * `contextKeys` is captured at construction (from the providing plugin's ctx, which injects
	 * it): a service called through a consumer's ctx must not need that consumer to inject it.
	 */
	constructor(
		ctx: Context,
		private readonly contextKeys: ContextKeysService
	) {
		super(ctx, 'commands');
	}

	/** Register a command; replaces the same id, the disposer removes only this command. */
	register(command: Command): () => void {
		if (command.when !== undefined) this.contextKeys.validate(command.when);
		return this.registry.register(command);
	}

	get(id: string): Command | undefined {
		return this.registry.get(id);
	}

	has(id: string): boolean {
		return this.registry.has(id);
	}

	/** Reactive: every registered command, enabled or not. */
	list(): readonly Command[] {
		return this.registry.list();
	}

	/** Reactive: false for unknown ids and while the command's `when` is false. */
	isEnabled(id: string): boolean {
		const command = this.registry.get(id);
		if (!command) return false;
		return this.contextKeys.evaluate(command.when);
	}

	/** Run a command by id. Rejects with a typed error; every failure also emits command/error. */
	async run(id: string, args?: unknown): Promise<void> {
		try {
			await this.execute(id, args);
		} catch (error) {
			this.ctx.emit('command/error', id, args, error);
			throw error;
		}
	}

	private async execute(id: string, args: unknown): Promise<void> {
		const command = this.registry.get(id);
		if (!command) throw new UnknownCommandError(id);
		if (!this.contextKeys.evaluate(command.when)) {
			throw new CommandDisabledError(id, command.when ?? '');
		}
		const veto = this.ctx.bail('command/before', id, args);
		if (veto) throw new CommandVetoedError(id, veto);
		this.ctx.emit('command/run', id, args);
		await command.run(args);
	}
}
