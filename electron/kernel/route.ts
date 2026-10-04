// IPC registration as a kernel effect: every channel a plugin installs carries the
// `removeHandler` that undoes it, so no domain plugin writes raw IPC.
//
// The calling plugin must `inject: ['electron', 'ipc']`: route reads Electron through the
// `electron` service and the sender policy through `ipc`, so the dependencies are explicit.

import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import type {
	IpcChannel,
	IpcContract,
	IpcErrorCode,
	IpcEventChannel,
	IpcEvents,
	IpcFailure,
	IpcResult
} from '../bridge';
import { payloadSchemas } from '../schemas';
import type { IpcInvokeEvent, WindowHandle } from './host';

/** Throw from a handler to reply with a specific error code instead of HANDLER_FAILED. */
export class IpcError extends Error {
	constructor(
		readonly code: IpcErrorCode,
		message: string
	) {
		super(message);
		this.name = 'IpcError';
	}
}

export type RouteHandler<Channel extends IpcChannel> = (
	payload: IpcContract[Channel]['payload'],
	event: IpcInvokeEvent
) => IpcContract[Channel]['result'] | Promise<IpcContract[Channel]['result']>;

function failure(code: IpcErrorCode, message: string): IpcResult<never> {
	const error: IpcFailure = { code, message };
	return { ok: false, error };
}

function describeError(error: unknown): IpcFailure {
	if (error instanceof IpcError) return { code: error.code, message: error.message };
	if (error instanceof Error) return { code: 'HANDLER_FAILED', message: error.message };
	return { code: 'HANDLER_FAILED', message: String(error) };
}

/**
 * Register `handler` for `channel` for as long as the calling fiber lives. Every call is checked
 * in this order: sender is one of our windows' top frame on a trusted origin, payload matches the
 * channel's schema, then the handler runs. Errors reply as `{ ok: false, error: { code, message } }`.
 */
export function route<Channel extends IpcChannel>(
	ctx: Context,
	channel: Channel,
	handler: RouteHandler<Channel>
): () => Promise<void> {
	return ctx.effect(() => {
		const { ipcMain } = ctx.electron;
		const ipc = ctx.ipc;
		const schema: z.ZodType<IpcContract[Channel]['payload']> = payloadSchemas[channel];
		ipcMain.handle(
			channel,
			async (event, payload): Promise<IpcResult<IpcContract[Channel]['result']>> => {
				if (!ipc.isTrustedSender(event)) {
					return failure('FORBIDDEN_SENDER', `untrusted sender for ${channel}`);
				}
				const parsed = schema.safeParse(payload);
				if (!parsed.success) return failure('INVALID_PAYLOAD', z.prettifyError(parsed.error));
				try {
					return { ok: true, value: await handler(parsed.data, event) };
				} catch (error) {
					return { ok: false, error: describeError(error) };
				}
			}
		);
		return () => ipcMain.removeHandler(channel);
	}, `ipc:${channel}`);
}

/** Push a typed event to one window's renderer. */
export function emitTo<Channel extends IpcEventChannel>(
	window: WindowHandle,
	channel: Channel,
	payload: IpcEvents[Channel]
): void {
	if (window.isDestroyed()) return;
	window.send(channel, payload);
}
