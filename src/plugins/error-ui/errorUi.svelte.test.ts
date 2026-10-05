import { Context, type Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagnosticsReport } from '../../../electron/bridge';
import { bootKernel, type BootReport } from '../../lib/kernel/boot.svelte';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { DISABLED_PLUGINS_KEY, failingPlugins } from '../../lib/kernel/startup';
import { describePlugin, installFakeDesktop, type FakeDesktop } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import errorUi from './index';

const providers = [
	coreRegions,
	coreContextKeys,
	coreCommands,
	coreKeymap,
	coreMenus,
	desktopBridge
] as Plugin[];

const diagnostics: DiagnosticsReport = {
	app: {
		version: '1.2.3',
		electron: '44',
		chrome: '140',
		platform: 'linux',
		arch: 'x64',
		safeMode: false
	},
	main: ['[main:files] opened'],
	renderer: ['[error] boom']
};

describePlugin('error-ui', errorUi, {
	providers,
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.errorUi).toBeDefined();
		const overlay = ctx.regions.contributions('overlay').map((entry) => entry.id);
		expect(overlay).toContain('error-ui/dialog');
		expect(overlay).toContain('error-ui/toasts');
		expect(ctx.commands.has('app.pluginStatus')).toBe(true);
		expect(ctx.commands.has('app.restartSafeMode')).toBe(true);
	}
});

let host: { target: HTMLElement; instance: ReturnType<typeof mount> } | undefined;
let desktop: FakeDesktop | undefined;
const written: string[] = [];
const restarts: boolean[] = [];

afterEach(async () => {
	if (host) {
		await unmount(host.instance);
		host.target.remove();
		host = undefined;
	}
	desktop?.restore();
	desktop = undefined;
	written.length = 0;
	restarts.length = 0;
	localStorage.removeItem(DISABLED_PLUGINS_KEY);
});

async function settle(): Promise<void> {
	for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

async function bootWithFailures(): Promise<BootReport> {
	const ctx = new Context();
	desktop = installFakeDesktop({
		diagnostics: {
			read: () => Promise.resolve(diagnostics),
			restart: (safeMode) => {
				restarts.push(safeMode);
				return Promise.resolve();
			}
		},
		clipboard: {
			read: () => Promise.resolve({ text: null, html: null, png: null }),
			write: (content) => {
				if (content.text !== undefined) written.push(content.text);
				return Promise.resolve();
			}
		}
	});
	const report = await bootKernel(ctx, [...providers, errorUi, ...failingPlugins]);
	ctx.emit('kernel/booted', report);
	const target = document.createElement('div');
	document.body.append(target);
	host = { target, instance: mount(HostRoot, { target, props: { ctx, region: 'overlay' } }) };
	await settle();
	return report;
}

function dialog(): HTMLElement | null {
	return document.querySelector('[data-error-ui-dialog]');
}

function buttonLabelled(label: string, within: ParentNode = document): HTMLElement | undefined {
	return [...within.querySelectorAll<HTMLElement>('button')].find(
		(button) => button.textContent.trim() === label
	);
}

describe('boot report dialog', () => {
	it('opens by itself for a failing plugin and lists failed and pending ones', async () => {
		await bootWithFailures();
		expect(dialog()).not.toBeNull();
		const failed = document.querySelector('[data-error-ui-plugin="qa-throws-on-mount"]');
		expect(failed?.getAttribute('data-status')).toBe('failed');
		expect(failed?.textContent).toContain('always fails to mount');
		const pending = document.querySelector('[data-error-ui-plugin="qa-waits-for-missing-service"]');
		expect(pending?.getAttribute('data-status')).toBe('pending');
	});

	it('the app stays usable: the other plugins are active and the dialog closes', async () => {
		const report = await bootWithFailures();
		expect(report.records.filter((record) => record.status === 'active').length).toBeGreaterThan(5);
		buttonLabelled('Close')?.click();
		flushSync();
		expect(dialog()).toBeNull();
	});

	it('disable unloads the plugin and remembers it for the next start', async () => {
		const report = await bootWithFailures();
		const failed = document.querySelector('[data-error-ui-plugin="qa-throws-on-mount"]');
		buttonLabelled('Disable', failed ?? document)?.click();
		await settle();
		const record = report.records.find((entry) => entry.name === 'qa-throws-on-mount');
		expect(record?.status).toBe('disabled');
		expect(localStorage.getItem(DISABLED_PLUGINS_KEY)).toBe('["qa-throws-on-mount"]');
	});

	it('copy diagnostics puts versions, plugin problems and logs on the clipboard', async () => {
		await bootWithFailures();
		buttonLabelled('Copy diagnostics')?.click();
		await settle();
		expect(written).toHaveLength(1);
		expect(written[0]).toContain('app 1.2.3, electron 44');
		expect(written[0]).toContain('failed qa-throws-on-mount: qa-throws-on-mount');
		expect(written[0]).toContain('pending qa-waits-for-missing-service');
		expect(written[0]).toContain('[main:files] opened');
		expect(written[0]).toContain('[error] boom');
	});

	it('restart in safe mode asks main to reload with core plugins only', async () => {
		await bootWithFailures();
		buttonLabelled('Restart in safe mode')?.click();
		await settle();
		expect(restarts).toEqual([true]);
	});

	it('the logs tab shows the renderer log and switches to main', async () => {
		await bootWithFailures();
		buttonLabelled('Logs')?.click();
		await settle();
		expect(document.querySelector('[data-error-ui-log]')?.textContent).toContain('[error] boom');
		buttonLabelled('Main')?.click();
		flushSync();
		expect(document.querySelector('[data-error-ui-log]')?.textContent).toContain('opened');
	});
});

describe('toasts', () => {
	it('an uncaught error becomes a toast', async () => {
		await bootWithFailures();
		window.dispatchEvent(new ErrorEvent('error', { message: 'kaboom' }));
		await settle();
		expect(document.querySelector('[data-error-ui-toast="error"]')?.textContent).toContain(
			'kaboom'
		);
	});
});
