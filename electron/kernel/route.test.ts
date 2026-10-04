import { FiberState, type Context, type Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import type { IpcResult } from '../bridge';
import type { IpcInvokeEvent } from './host';
import { IpcError, emitTo, route } from './route';
import { bootMinimalKernel, settle, TEST_ORIGIN } from './testing';

// A throwaway plugin that registers routes the way a domain plugin does.
function routesPlugin(register: (ctx: Context) => void): Plugin.Object {
	return { name: 'test-routes', inject: ['electron', 'ipc'], apply: register };
}

function reply(value: unknown): IpcResult<unknown> {
	return value as IpcResult<unknown>;
}

describe('route()', () => {
	it('registers the channel and replies { ok: true, value }', async () => {
		const { host } = await bootMinimalKernel([
			{ plugin: routesPlugin((ctx) => route(ctx, 'app:version', () => 'v-test')) }
		]);
		expect(host.handlers.has('app:version')).toBe(true);
		expect(await host.invoke('app:version')).toEqual({ ok: true, value: 'v-test' });
	});

	it('passes the parsed payload and the event to the handler', async () => {
		let seen: unknown[] = [];
		const { host } = await bootMinimalKernel([
			{
				plugin: routesPlugin((ctx) =>
					route(ctx, 'app:path', (name, event) => {
						seen = [name, event.sender.id];
						return '/somewhere';
					})
				)
			}
		]);
		await host.invoke('app:path', 'temp');
		expect(seen).toEqual(['temp', host.openWindows[0].sender.id]);
	});

	it('is removed on dispose: the fake ipcMain handler count returns to what it was', async () => {
		const { host, root } = await bootMinimalKernel([]);
		expect(host.handlers.size).toBe(0);
		const fiber = root.plugin(
			routesPlugin((ctx) => {
				route(ctx, 'app:version', () => 'x');
				route(ctx, 'app:quit', () => undefined);
			})
		);
		await fiber;
		expect(host.handlers.size).toBe(2);
		await fiber.dispose();
		expect(host.handlers.size).toBe(0);
		expect(await host.invoke('app:version').catch((error: Error) => error.message)).toContain(
			'No handler registered'
		);
	});

	it('disposing the route disposer alone removes just that channel', async () => {
		let removeVersion: () => Promise<void> = async () => {};
		const { host } = await bootMinimalKernel([
			{
				plugin: routesPlugin((ctx) => {
					removeVersion = route(ctx, 'app:version', () => 'x');
					route(ctx, 'app:quit', () => undefined);
				})
			}
		]);
		await removeVersion();
		expect([...host.handlers.keys()]).toEqual(['app:quit']);
	});

	it('a plugin that does not inject electron and ipc cannot use route()', async () => {
		const { root, host } = await bootMinimalKernel([]);
		const sloppy: Plugin.Object = {
			name: 'sloppy',
			apply(ctx) {
				route(ctx, 'app:version', () => 'x');
			}
		};
		const fiber = root.plugin(sloppy);
		await expect(fiber).rejects.toThrow(/without inject/);
		expect(fiber.state).toBe(FiberState.FAILED);
		expect(host.handlers.size).toBe(0);
	});

	it('rejects an invalid payload with a typed error and never runs the handler', async () => {
		let calls = 0;
		const { host } = await bootMinimalKernel([
			{
				plugin: routesPlugin((ctx) =>
					route(ctx, 'app:path', () => {
						calls += 1;
						return '/x';
					})
				)
			}
		]);
		const result = reply(await host.invoke('app:path', 'not-a-path'));
		expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
		expect(calls).toBe(0);
		expect(reply(await host.invoke('app:path'))).toMatchObject({
			ok: false,
			error: { code: 'INVALID_PAYLOAD' }
		});
	});

	it('rejects unknown keys in an options payload and accepts a valid one', async () => {
		const { host } = await bootMinimalKernel([
			{ plugin: routesPlugin((ctx) => route(ctx, 'dialogs:saveFile', () => '/saved')) }
		]);
		expect(reply(await host.invoke('dialogs:saveFile', { evil: true }))).toMatchObject({
			ok: false,
			error: { code: 'INVALID_PAYLOAD' }
		});
		expect(await host.invoke('dialogs:saveFile', { title: 't' })).toEqual({
			ok: true,
			value: '/saved'
		});
		expect(await host.invoke('dialogs:saveFile')).toEqual({ ok: true, value: '/saved' });
	});

	describe('sender validation', () => {
		async function guarded(): Promise<{
			host: Awaited<ReturnType<typeof bootMinimalKernel>>['host'];
			calls: () => number;
		}> {
			let calls = 0;
			const { host } = await bootMinimalKernel([
				{
					plugin: routesPlugin((ctx) =>
						route(ctx, 'app:version', () => {
							calls += 1;
							return 'v';
						})
					)
				}
			]);
			return { host, calls: () => calls };
		}

		async function forbidden(event: IpcInvokeEvent): Promise<void> {
			const { host, calls } = await guarded();
			const result = reply(await host.invoke('app:version', undefined, event));
			expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } });
			expect(calls()).toBe(0);
		}

		it('rejects a sender that is not one of our windows', async () => {
			await forbidden({
				sender: { id: 999 },
				senderFrame: { url: `${TEST_ORIGIN}/`, parent: null }
			});
		});

		it('rejects a foreign origin even from our own window', async () => {
			const { host } = await guarded();
			const sender = host.openWindows[0].sender;
			await forbidden({ sender, senderFrame: { url: 'https://evil.example/', parent: null } });
		});

		it('rejects a child frame, a destroyed frame and a malformed url', async () => {
			const { host } = await guarded();
			const sender = host.openWindows[0].sender;
			await forbidden({ sender, senderFrame: { url: `${TEST_ORIGIN}/`, parent: {} } });
			await forbidden({ sender, senderFrame: null });
			await forbidden({ sender, senderFrame: { url: 'not a url', parent: null } });
		});

		it('rejects a lookalike origin', async () => {
			const { host } = await guarded();
			const sender = host.openWindows[0].sender;
			await forbidden({ sender, senderFrame: { url: 'app://design.evil/', parent: null } });
			await forbidden({ sender, senderFrame: { url: 'http://design/', parent: null } });
		});

		it('accepts the top frame of our window on the trusted origin, with any path', async () => {
			const { host, calls } = await guarded();
			const event: IpcInvokeEvent = {
				sender: host.openWindows[0].sender,
				senderFrame: { url: `${TEST_ORIGIN}/some/route?x=1#y`, parent: null }
			};
			expect(await host.invoke('app:version', undefined, event)).toEqual({ ok: true, value: 'v' });
			expect(calls()).toBe(1);
		});
	});

	describe('error serialisation', () => {
		async function replyFrom(thrown: () => never): Promise<unknown> {
			const { host } = await bootMinimalKernel([
				{ plugin: routesPlugin((ctx) => route(ctx, 'app:version', thrown)) }
			]);
			return host.invoke('app:version');
		}

		it('turns a thrown Error into HANDLER_FAILED with its message', async () => {
			expect(
				await replyFrom(() => {
					throw new Error('disk on fire');
				})
			).toEqual({ ok: false, error: { code: 'HANDLER_FAILED', message: 'disk on fire' } });
		});

		it('keeps the code of a thrown IpcError', async () => {
			expect(
				await replyFrom(() => {
					throw new IpcError('UNKNOWN_CHANNEL', 'nope');
				})
			).toEqual({ ok: false, error: { code: 'UNKNOWN_CHANNEL', message: 'nope' } });
		});

		it('survives a non-Error throw', async () => {
			expect(
				await replyFrom(() => {
					throw 'just a string';
				})
			).toEqual({ ok: false, error: { code: 'HANDLER_FAILED', message: 'just a string' } });
		});

		it('awaits async handlers', async () => {
			const { host } = await bootMinimalKernel([
				{
					plugin: routesPlugin((ctx) =>
						route(ctx, 'app:version', async () => {
							await settle();
							return 'late';
						})
					)
				}
			]);
			expect(await host.invoke('app:version')).toEqual({ ok: true, value: 'late' });
		});
	});
});

describe('emitTo()', () => {
	it('pushes a typed event to the window and skips destroyed windows', async () => {
		const { window } = await bootMinimalKernel([]);
		emitTo(window, 'window:maximized', true);
		expect(window.sent).toEqual([{ channel: 'window:maximized', payload: true }]);
		window.destroyed = true;
		emitTo(window, 'window:maximized', false);
		expect(window.sent).toHaveLength(1);
	});
});
