// main-ipc: the `ipc` service. Holds the sender policy `route()` enforces (only a top frame of one
// of our windows, on a trusted origin: `app://design` in production, the dev server in dev), the
// main-to-renderer push helper, and the latest boot report.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { z } from 'zod';
import type { BootReport, IpcEventChannel, IpcEvents } from '../bridge';
import type { IpcInvokeEvent } from '../kernel/host';
import { emitTo } from '../kernel/route';

function originOf(url: string): string | null {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return null;
	}
}

export const ipcConfigSchema = z.strictObject({
	/** Origins (`scheme://host[:port]`) allowed to call IPC. */
	trustedOrigins: z.array(z.string()).min(1)
});
export type IpcConfig = z.infer<typeof ipcConfigSchema>;

export class IpcService extends Service {
	private readonly trustedOrigins: ReadonlySet<string>;
	private latestBootReport: BootReport | null = null;

	constructor(ctx: Context, config: IpcConfig) {
		super(ctx, 'ipc');
		this.trustedOrigins = new Set(config.trustedOrigins);
	}

	isTrustedSender(event: IpcInvokeEvent): boolean {
		if (!this.ctx.electron.windowFromSender(event.sender)) return false;
		const frame = event.senderFrame;
		if (!frame) return false;
		if (frame.parent !== null) return false;
		const origin = originOf(frame.url);
		if (origin === null) return false;
		return this.trustedOrigins.has(origin);
	}

	/** Push to every open window. */
	broadcast<Channel extends IpcEventChannel>(channel: Channel, payload: IpcEvents[Channel]): void {
		for (const window of this.ctx.electron.windows()) emitTo(window, channel, payload);
	}

	get bootReport(): BootReport | null {
		return this.latestBootReport;
	}

	/** Remember the report for late-loading renderers and push it to the ones already there. */
	publishBootReport(report: BootReport): void {
		this.latestBootReport = report;
		this.broadcast('kernel:boot-report', report);
	}
}

export const mainIpcPlugin: Plugin.Object<IpcConfig> = {
	name: 'main-ipc',
	inject: ['electron'],
	Config: ipcConfigSchema,
	apply(ctx, config) {
		new IpcService(ctx, config);
	}
};
