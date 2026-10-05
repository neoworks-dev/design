import { describe, expect, it } from 'vitest';
import type { DiagnosticsReport, IpcResult } from '../bridge';
import { bootTestKernel, settle } from '../kernel/testing';
import { LogBuffer } from './diagnostics';

async function readDiagnostics(
	host: Awaited<ReturnType<typeof bootTestKernel>>['host']
): Promise<DiagnosticsReport> {
	const answer = (await host.invoke('diagnostics:read')) as IpcResult<DiagnosticsReport>;
	if (!answer.ok) throw new Error(answer.error.message);
	return answer.value;
}

describe('LogBuffer', () => {
	it('keeps the newest lines, oldest first', () => {
		const buffer = new LogBuffer(3);
		for (const line of ['a', 'b', 'c', 'd']) buffer.push(line);
		expect(buffer.snapshot()).toEqual(['b', 'c', 'd']);
	});
});

describe('main-diagnostics', () => {
	it('registers its routes and removes them on unload', async () => {
		const { host, root } = await bootTestKernel();
		expect(host.snapshot().handlers).toEqual(
			expect.arrayContaining(['diagnostics:read', 'diagnostics:restart'])
		);
		await root.fiber.dispose();
		await settle();
		expect(host.handlers.has('diagnostics:read')).toBe(false);
		expect(host.handlers.has('diagnostics:restart')).toBe(false);
	});

	it('collects renderer console lines and main log lines for diagnostics:read', async () => {
		const { host, root } = await bootTestKernel();
		host.openWindows[0].logFromRenderer('error', 'renderer says boom');
		root.logger('test').info('main says hello');
		const report = await readDiagnostics(host);
		expect(report.renderer).toContain('[error] renderer says boom');
		expect(report.main.some((line) => line.includes('main says hello'))).toBe(true);
		expect(report.app.safeMode).toBe(false);
	});

	it('a crashed renderer asks, then reloads the window', async () => {
		const { host } = await bootTestKernel();
		const window = host.openWindows[0];
		host.messageBoxResult = 0;
		const loads = window.loadedUrls.length;
		window.crashRenderer('crashed');
		await settle();
		expect(host.messageBoxRequests[0].message).toContain('stopped working');
		expect(window.loadedUrls).toHaveLength(loads + 1);
		expect(window.loadedUrls[loads]).not.toContain('safe=1');
		expect((await readDiagnostics(host)).renderer.join('\n')).toContain('crashed');
	});

	it('choosing safe mode after a crash reloads with ?safe=1', async () => {
		const { host } = await bootTestKernel();
		const window = host.openWindows[0];
		host.messageBoxResult = 1;
		window.crashRenderer('oom');
		await settle();
		expect(window.loadedUrls[window.loadedUrls.length - 1]).toContain('safe=1');
		expect((await readDiagnostics(host)).app.safeMode).toBe(true);
	});

	it('quitting from the crash prompt does not reload', async () => {
		const { host } = await bootTestKernel();
		const window = host.openWindows[0];
		host.messageBoxResult = 2;
		const loads = window.loadedUrls.length;
		window.crashRenderer('killed');
		await settle();
		expect(window.loadedUrls).toHaveLength(loads);
	});

	it('a clean exit is not a crash', async () => {
		const { host } = await bootTestKernel();
		host.openWindows[0].crashRenderer('clean-exit');
		await settle();
		expect(host.messageBoxRequests).toHaveLength(0);
	});

	it('an unresponsive page offers Wait or Reload, and Wait leaves it alone', async () => {
		const { host } = await bootTestKernel();
		const window = host.openWindows[0];
		host.messageBoxResult = 1;
		const loads = window.loadedUrls.length;
		window.hangRenderer();
		await settle();
		expect(host.messageBoxRequests[0].buttons).toEqual(['Reload', 'Wait']);
		expect(window.loadedUrls).toHaveLength(loads);

		host.messageBoxResult = 0;
		window.hangRenderer();
		await settle();
		expect(window.loadedUrls).toHaveLength(loads + 1);
	});

	it('diagnostics:restart reloads in the requested mode', async () => {
		const { host } = await bootTestKernel();
		const window = host.openWindows[0];
		await host.invoke('diagnostics:restart', { safeMode: true });
		expect(window.loadedUrls[window.loadedUrls.length - 1]).toContain('safe=1');
		await host.invoke('diagnostics:restart', { safeMode: false });
		expect(window.loadedUrls[window.loadedUrls.length - 1]).not.toContain('safe=1');
	});
});
