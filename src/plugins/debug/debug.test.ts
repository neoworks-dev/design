import type { Context, Plugin } from '@neoworks/extension-system';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { BootReport } from '../../lib/kernel/boot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import debug from './index';
import { isDebugEnabled } from './enabled';
import type { DesignDebug } from './surface';

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

function installed(): DesignDebug | undefined {
	const surface: unknown = Reflect.get(window, '__design_debug');
	if (surface === undefined) return undefined;
	return surface as DesignDebug;
}

function surface(): DesignDebug {
	const found = installed();
	if (!found) throw new Error('window.__design_debug is not installed');
	return found;
}

function service(name: string, value: unknown): Plugin {
	return {
		name: `fake-${name}`,
		inject: [],
		apply: (ctx: Context) => void ctx.provide(name, value)
	} as Plugin;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('debug plugin', () => {
	it('installs window.__design_debug on mount and removes it on dispose', async () => {
		expect(installed()).toBeUndefined();
		mounted = await mountPlugin(debug, { config: { enabled: true } });
		expect(installed()).toBeDefined();
		expect(surface().ctx).toBe(mounted.ctx.root);
		await mounted.assertUnmountsClean();
		expect(installed()).toBeUndefined();
	});

	it('installs nothing when disabled', async () => {
		mounted = await mountPlugin(debug, { config: { enabled: false } });
		expect(installed()).toBeUndefined();
	});

	it('summary() on an empty kernel has the documented fields with nothing filled in', async () => {
		mounted = await mountPlugin(debug, { config: { enabled: true } });
		expect(surface().summary()).toEqual({
			page: null,
			selection: [],
			tool: null,
			zoom: null,
			nodeCount: null,
			failed: [],
			services: []
		});
	});

	it('summary() reads the page, selection, tool, zoom and node count from the services', async () => {
		mounted = await mountPlugin(debug, {
			config: { enabled: true },
			providers: [
				service('document', {
					currentPageId: 'page-1',
					snapshot: { nodes: { 'page-1': {}, a: {}, b: {} } }
				}),
				service('selection', { ids: ['a', 'b'] }),
				service('tools', { activeId: () => 'rectangle' }),
				service('viewport', { zoom: 1.5, worldToScreen: (point: unknown) => point })
			]
		});
		await settle();
		expect(surface().summary()).toEqual({
			page: 'page-1',
			selection: ['a', 'b'],
			tool: 'rectangle',
			zoom: 1.5,
			nodeCount: 3,
			failed: [],
			services: ['tools', 'document', 'selection', 'viewport']
		});
		expect(Reflect.get(surface().viewport as object, 'worldToScreen')).toBeTypeOf('function');
	});

	it('a service appears when its plugin is provided and disappears when it is removed', async () => {
		mounted = await mountPlugin(debug, { config: { enabled: true } });
		expect(surface().history).toBeUndefined();
		const history = { undo: () => {} };
		const fiber = await mounted.ctx.plugin(service('history', history));
		await settle();
		expect(surface().history).toBe(history);
		await fiber.dispose();
		await settle();
		expect(surface().history).toBeUndefined();
	});

	it('plugins() lists live fibers with their state and the error of a failed one', async () => {
		mounted = await mountPlugin(debug, { config: { enabled: true } });
		const broken = {
			name: 'broken-plugin',
			inject: [],
			apply: (): void => {
				throw new Error('kaboom');
			}
		} as Plugin;
		try {
			await mounted.ctx.plugin(broken);
		} catch {
			// the failure is what this test inspects
		}
		const waiting = {
			name: 'waiting-plugin',
			inject: ['nothing'],
			apply: (): void => {}
		} as Plugin;
		void mounted.ctx.plugin(waiting);
		await settle();

		const plugins = surface().plugins();
		expect(plugins).toContainEqual({ name: 'debug', state: 'active' });
		expect(plugins).toContainEqual({ name: 'broken-plugin', state: 'failed', error: 'kaboom' });
		expect(plugins).toContainEqual({ name: 'waiting-plugin', state: 'pending' });
		expect(surface().summary().failed).toEqual(['broken-plugin: kaboom']);
	});

	it('plugins() also reports what the boot report knows', async () => {
		mounted = await mountPlugin(debug, { config: { enabled: true } });
		const report = {
			records: [
				{ name: 'ghost', status: 'failed', error: 'never mounted' },
				{ name: 'debug', status: 'active' }
			]
		} as BootReport;
		mounted.ctx.emit('kernel/booted', report);
		expect(surface().plugins()).toContainEqual({
			name: 'ghost',
			state: 'failed',
			error: 'never mounted'
		});
		expect(
			surface()
				.plugins()
				.filter((plugin) => plugin.name === 'debug')
		).toHaveLength(1);
	});

	it('exposes the labelled effect tree through ctx', async () => {
		mounted = await mountPlugin(debug, { config: { enabled: true } });
		expect(
			surface()
				.ctx.fiber.getEffects()
				.map((effect) => effect.label)
		).toContain('ctx.plugin()');
		expect(mounted.fiber.getEffects().map((effect) => effect.label)).toContain(
			'debug/window.__design_debug'
		);
	});
});

describe('when the hook exists', () => {
	it('is on in dev and in a QA session, off in a plain production load', () => {
		expect(isDebugEnabled({ dev: true, search: '' })).toBe(true);
		expect(isDebugEnabled({ dev: false, search: '?qa=1' })).toBe(true);
		expect(isDebugEnabled({ dev: false, search: '?other=1&qa=1' })).toBe(true);
		expect(isDebugEnabled({ dev: false, search: '' })).toBe(false);
		expect(isDebugEnabled({ dev: false, search: '?qa=0' })).toBe(false);
		expect(isDebugEnabled({ dev: false, search: '?qa' })).toBe(false);
	});

	it('the plugin source gates installation on isDebugEnabled(currentEnvironment())', () => {
		const source = readFileSync(`${import.meta.dirname}/index.ts`, 'utf8');
		expect(source).toContain('isDebugEnabled(currentEnvironment())');
		expect(source.indexOf('if (!isEnabled(config)) return;')).toBeLessThan(
			source.indexOf("Reflect.set(window, '__design_debug'")
		);
	});
});

describePlugin('debug', debug, {
	config: { enabled: true },
	contributes: () => {
		expect(installed()).toBeDefined();
	}
});
