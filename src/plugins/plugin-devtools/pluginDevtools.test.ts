import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginList } from '../../../electron/bridge';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { inlineWorkers, type InlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginApiProviders,
	validManifest
} from '../../lib/plugins/fixtures/pluginFixture';
import pluginApi from '../plugin-api';
import pluginDevtools from './index';

const VERSION_ONE = `
	await design.commands.register('example.v1', async () => {});
	design.log.info('version one loaded');
`;
const VERSION_TWO = `
	await design.commands.register('example.v2', async () => {});
	design.log.warn('version two loaded');
`;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(value: number): string {
	let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
	let text = '';
	do {
		let digit = remaining & 31;
		remaining >>>= 5;
		if (remaining > 0) digit |= 32;
		text += BASE64[digit];
	} while (remaining > 0);
	return text;
}
/** Generated 1:0 is src/main.ts 10:4. */
const SOURCE_MAP = JSON.stringify({
	version: 3,
	sources: ['src/main.ts'],
	mappings: [0, 0, 9, 4].map(vlq).join('')
});

let workers: InlineWorkers = inlineWorkers();
let mounted: MountedPlugin | undefined;
let files: Record<string, string> = {};
let created: { id: string; name: string; template: string }[] = [];

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function wait(milliseconds = 20): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mountDevtools(): Promise<Context> {
	workers = inlineWorkers();
	files = { 'user/example/main.js': VERSION_ONE, 'user/example/main.js.map': SOURCE_MAP };
	created = [];
	const manifest = validManifest({
		permissions: [],
		contributes: { commands: [{ id: 'example.v1', title: 'Version one' }] }
	});
	const list = listOf(discovered(manifest, { directoryName: 'example' }));
	const section = fakePluginsSection(() => list, files);
	section.readFile = (source, directoryName, file) => {
		const text = files[`${source}/${directoryName}/${file}`];
		if (text === undefined) return Promise.reject(new Error(`no file ${file}`));
		return Promise.resolve(text);
	};
	section.create = (id, name, template) => {
		created.push({ id, name, template });
		return Promise.resolve(list as PluginList);
	};
	mounted = await mountPlugin(pluginDevtools, {
		providers: [...pluginApiProviders(workers.factory), pluginApi],
		desktop: { plugins: section }
	});
	await wait();
	return mounted.ctx;
}

describePlugin('plugin-devtools', pluginDevtools, {
	providers: [...pluginApiProviders(inlineWorkers().factory), pluginApi],
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx, currentState }) => {
		expect(ctx.commands.has('plugin-devtools.console')).toBe(true);
		expect(ctx.commands.has('plugin-devtools.create')).toBe(true);
		expect(currentState().registries['keymap.registry']).toContain(
			'plugin-devtools|global|ctrl+alt+j|plugin-devtools.console'
		);
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toEqual(
			expect.arrayContaining(['plugin-devtools/console', 'plugin-devtools/create'])
		);
		expect(ctx.pluginHost.snapshotState().logListeners).toBe(1);
	}
});

describe('the plugin console', () => {
	it('collects what plugins print, filters by plugin and clears', async () => {
		const ctx = await mountDevtools();
		await ctx.pluginHost.activate('example');
		await wait();
		expect(
			ctx.pluginConsole.lines().map((line) => [line.pluginId, line.level, line.message])
		).toEqual([['example', 'info', 'version one loaded']]);
		ctx.pluginConsole.append('other', 'warn', 'careful');
		expect(ctx.pluginConsole.pluginIds()).toEqual(['example', 'other']);
		ctx.pluginConsole.setFilter('other');
		expect(ctx.pluginConsole.lines().map((line) => line.message)).toEqual(['careful']);
		ctx.pluginConsole.clear();
		expect(ctx.pluginConsole.lines()).toEqual([]);
	});

	it('shows why a plugin failed', async () => {
		const ctx = await mountDevtools();
		ctx.pluginHost.fail('example', 'it hung');
		expect(ctx.pluginConsole.lines().map((line) => [line.level, line.message])).toEqual([
			['error', 'it hung']
		]);
	});

	it('maps a stack trace to the original source through main.js.map', async () => {
		const ctx = await mountDevtools();
		ctx.pluginConsole.append(
			'example',
			'error',
			'Error: boom\n    at run (blob:app://design/1234:1:3)\n    at other (app://design/chunk.js:9:9)'
		);
		await wait();
		expect(ctx.pluginConsole.lines()[0].message).toBe(
			'Error: boom\n    at run (src/main.ts:10:5)\n    at other (app://design/chunk.js:9:9)'
		);
	});

	it('keeps the raw trace when the plugin ships no source map', async () => {
		const ctx = await mountDevtools();
		delete files['user/example/main.js.map'];
		const trace = 'Error: boom\n    at run (blob:app://design/1234:1:3)';
		ctx.pluginConsole.append('example', 'error', trace);
		await wait();
		expect(ctx.pluginConsole.lines()[0].message).toBe(trace);
	});
});

describe('hot reload', () => {
	it('restarts a running plugin with the new files and reverts what the old one registered', async () => {
		const ctx = await mountDevtools();
		await ctx.pluginHost.activate('example');
		await wait();
		expect(ctx.commands.has('example.v1')).toBe(true);

		files['user/example/main.js'] = VERSION_TWO;
		const started = Date.now();
		await ctx.pluginConsole.handleReload({ source: 'user', directoryName: 'example' });
		expect(Date.now() - started).toBeLessThan(1000);
		await wait();

		expect(workers.created).toHaveLength(2);
		expect(workers.created[0].worker.terminated).toBe(true);
		expect(ctx.commands.has('example.v2')).toBe(true);
		expect(ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message)).toEqual([
			'version two loaded'
		]);
		const messages = ctx.pluginConsole.lines().map((line) => line.message);
		expect(messages).toContain('version one loaded');
		expect(messages).toContain('version two loaded');
		expect(messages.some((message) => message.startsWith('Reloaded in'))).toBe(true);
	});

	it('keeps the running version and shows the compiler output when the build fails', async () => {
		const ctx = await mountDevtools();
		await ctx.pluginHost.activate('example');
		await ctx.pluginConsole.handleReload({
			source: 'user',
			directoryName: 'example',
			build: { ok: false, output: 'main.ts(1,1): error TS1005' }
		});
		expect(workers.created).toHaveLength(1);
		const errors = ctx.pluginConsole.lines().filter((line) => line.level === 'error');
		expect(errors.map((line) => line.message)).toEqual([
			'main.ts(1,1): error TS1005',
			'The build failed; the running version stays.'
		]);
	});

	it('does not start a plugin nobody used', async () => {
		const ctx = await mountDevtools();
		await ctx.pluginConsole.handleReload({ source: 'user', directoryName: 'example' });
		expect(workers.created).toEqual([]);
		expect(ctx.pluginConsole.lines()[0]).toMatchObject({ level: 'system' });
	});
});

describe('create plugin', () => {
	it('writes the template and opens the console', async () => {
		const ctx = await mountDevtools();
		ctx.pluginConsole.openCreate();
		await ctx.pluginConsole.create('My Tool', 'panel');
		expect(created).toEqual([{ id: 'my-tool', name: 'My Tool', template: 'panel' }]);
		expect(ctx.pluginConsole.createOpen).toBe(false);
		expect(ctx.pluginConsole.isOpen).toBe(true);
	});

	it('asks for a name when there is none', async () => {
		const ctx = await mountDevtools();
		ctx.pluginConsole.openCreate();
		await ctx.pluginConsole.create('  !!  ', 'blank');
		expect(created).toEqual([]);
		expect(ctx.pluginConsole.createOpen).toBe(true);
		expect(ctx.pluginConsole.notice?.error).toBe(true);
	});
});
