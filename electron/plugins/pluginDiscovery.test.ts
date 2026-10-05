import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IpcResult, PluginList } from '../bridge';
import { bootTestKernel, settle, type TestKernel } from '../kernel/testing';
import { isInside, parseTrustFile, TRUST_FILE } from './pluginDiscovery';

const BUNDLED = '/fake/bundled-plugins';
const manifest = (id: string): string => JSON.stringify({ id, name: id, version: '1.0.0' });

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-plugins-test-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

async function boot(): Promise<TestKernel> {
	const kernel = await bootTestKernel({ host: { paths: { userData: directory } } });
	kernel.host.setPluginFile(`${BUNDLED}/grid/manifest.json`, manifest('grid'));
	kernel.host.setPluginFile(`${userRoot()}/notes/manifest.json`, manifest('notes'));
	return kernel;
}

function userRoot(): string {
	return path.join(directory, 'plugins');
}

async function call(kernel: TestKernel, channel: string, payload?: unknown): Promise<PluginList> {
	const result = (await kernel.host.invoke(channel, payload)) as IpcResult<PluginList>;
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
}

/** Give the test window a saved document in `project`, the way `store:create` does. */
async function openProject(kernel: TestKernel, project: string): Promise<void> {
	mkdirSync(project, { recursive: true });
	const file = path.join(project, 'a.ndesign');
	const result = (await kernel.host.invoke('store:create', { path: file })) as IpcResult<unknown>;
	if (!result.ok) throw new Error(result.error.message);
	await settle();
}

function sentLists(kernel: TestKernel): PluginList[] {
	return kernel.host.openWindows[0].sent
		.filter((message) => message.channel === 'plugins:changed')
		.map((message) => message.payload as PluginList);
}

function waitForWatchers(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 300));
}

describe('main-plugins discovery', () => {
	it('lists built-in and user plugins with their parsed manifests', async () => {
		const kernel = await boot();
		const result = await call(kernel, 'plugins:list');
		expect(result.project).toBeNull();
		expect(result.plugins.map((plugin) => [plugin.source, plugin.directoryName])).toEqual([
			['builtin', 'grid'],
			['user', 'notes']
		]);
		expect(result.plugins[0].manifest).toEqual({ id: 'grid', name: 'grid', version: '1.0.0' });
		expect(result.plugins.every((plugin) => plugin.trusted)).toBe(true);
	});

	it('reports a missing or broken manifest on the entry instead of dropping the plugin', async () => {
		const kernel = await boot();
		kernel.host.setPluginFile(`${userRoot()}/broken/manifest.json`, '{nope');
		kernel.host.setPluginFile(`${userRoot()}/empty/main.js`, '');
		const result = await call(kernel, 'plugins:list');
		const broken = result.plugins.find((plugin) => plugin.directoryName === 'broken');
		const empty = result.plugins.find((plugin) => plugin.directoryName === 'empty');
		expect(broken).toMatchObject({ manifest: null });
		expect(broken?.error).toContain('not valid JSON');
		expect(empty).toMatchObject({ manifest: null, error: 'no manifest.json' });
	});

	it('lists project plugins as untrusted until trusted, and refuses to read untrusted ones', async () => {
		const kernel = await boot();
		kernel.host.messageBoxResult = 1;
		const project = path.join(directory, 'project');
		kernel.host.setPluginFile(`${project}/.design/plugins/local/manifest.json`, manifest('local'));
		kernel.host.setPluginFile(`${project}/.design/plugins/local/main.js`, 'export {}');
		await openProject(kernel, project);

		const result = await call(kernel, 'plugins:list');
		const local = result.plugins.find((plugin) => plugin.source === 'project');
		expect(local).toMatchObject({ directoryName: 'local', trusted: false });
		expect(result.projectTrust).toBe('untrusted');
		const readRequest = { source: 'project', directoryName: 'local', file: 'main.js' };
		const refused = (await kernel.host.invoke(
			'plugins:readFile',
			readRequest
		)) as IpcResult<string>;
		expect(refused.ok).toBe(false);

		const trusted = await call(kernel, 'plugins:setTrust', { trusted: true });
		expect(trusted.plugins.find((plugin) => plugin.source === 'project')?.trusted).toBe(true);
		expect(kernel.host.userData.readText(TRUST_FILE)).toContain(project);
		const allowed = (await kernel.host.invoke(
			'plugins:readFile',
			readRequest
		)) as IpcResult<string>;
		expect(allowed).toEqual({ ok: true, value: 'export {}' });
	});

	it('asks once about a project with plugins and applies the answer', async () => {
		const kernel = await boot();
		kernel.host.messageBoxResult = 0;
		const project = path.join(directory, 'asked');
		kernel.host.setPluginFile(`${project}/.design/plugins/local/manifest.json`, manifest('local'));
		await openProject(kernel, project);
		await settle();
		expect(kernel.host.messageBoxRequests).toHaveLength(1);
		expect(kernel.host.messageBoxRequests[0].detail).toContain('local');
		const last = sentLists(kernel).at(-1);
		expect(last?.projectTrust).toBe('trusted');
		expect(last?.plugins.find((plugin) => plugin.source === 'project')?.trusted).toBe(true);
	});

	it('never reads files outside the plugin directory', async () => {
		const kernel = await boot();
		const answer = (await kernel.host.invoke('plugins:readFile', {
			source: 'user',
			directoryName: 'notes',
			file: '../../secret.txt'
		})) as IpcResult<string>;
		expect(answer.ok).toBe(false);
		expect(isInside('/a/b', '/a/b/c')).toBe(true);
		expect(isInside('/a/b', '/a/c')).toBe(false);
	});

	it('pushes plugins:changed when a root changes, once per distinct list', async () => {
		const kernel = await boot();
		await call(kernel, 'plugins:list');
		kernel.host.setPluginFile(`${userRoot()}/added/manifest.json`, manifest('added'));
		await waitForWatchers();
		const lists = sentLists(kernel);
		expect(lists.at(-1)?.plugins.map((plugin) => plugin.directoryName)).toContain('added');
		const count = lists.length;
		kernel.host.setPluginFile(`${userRoot()}/added/manifest.json`, manifest('added'));
		await waitForWatchers();
		expect(sentLists(kernel)).toHaveLength(count);
	});

	it('closes every watcher and route when the kernel is disposed', async () => {
		const kernel = await boot();
		await openProject(kernel, path.join(directory, 'watched'));
		expect(kernel.host.pluginWatchers.size).toBe(3);
		await kernel.root.fiber.dispose();
		await settle();
		expect(kernel.host.pluginWatchers.size).toBe(0);
		expect(kernel.host.handlers.has('plugins:list')).toBe(false);
	});

	it('mounting adds its routes and watchers, unmounting leaves the host as it was', async () => {
		const kernel = await boot();
		const mounted = kernel.host.snapshot();
		expect(mounted.handlers).toEqual(
			expect.arrayContaining(['plugins:list', 'plugins:setTrust', 'plugins:readFile'])
		);
		expect(mounted.pluginWatchers).toHaveLength(2);
		await kernel.root.fiber.dispose();
		await settle();
		const after = kernel.host.snapshot();
		expect(after.handlers).toEqual([]);
		expect(after.pluginWatchers).toEqual([]);
	});

	it('reads trust decisions defensively', () => {
		expect(parseTrustFile(undefined)).toEqual({});
		expect(parseTrustFile('{oops')).toEqual({});
		expect(parseTrustFile('{"projects":{"/a":true}}')).toEqual({ '/a': true });
	});
});
