import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS } from './bridge';
import { payloadSchemas } from './schemas';

// Source-level checks: the preload runs sandboxed, so it can only be verified structurally here
// (the running app is covered by the qa eval transcript in the issue).

const directory = path.dirname(fileURLToPath(import.meta.url));
const preloadSource = readFileSync(path.join(directory, 'preload.ts'), 'utf8');

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('preload bridge', () => {
	it('imports only electron and local files, never packages (sandbox cannot resolve them)', () => {
		for (const specifier of importSpecifiers(preloadSource)) {
			const isLocal = specifier.startsWith('./');
			expect(isLocal || specifier === 'electron').toBe(true);
		}
		expect(importSpecifiers(preloadSource)).not.toContain('./schemas');
	});

	it('exposes every request channel of the contract, and no other', () => {
		const used = [...preloadSource.matchAll(/invoke\('([^']+)'/g)].map((match) => match[1]);
		expect(new Set(used)).toEqual(new Set(Object.keys(payloadSchemas)));
	});

	it('never hands the raw ipcRenderer to the renderer', () => {
		const exposedObject = preloadSource.slice(preloadSource.indexOf('const bridge'));
		expect(exposedObject).not.toContain('ipcRenderer');
		expect(preloadSource).toContain("exposeInMainWorld('desktop', bridge)");
	});

	it('only subscribes to whitelisted event channels', () => {
		expect(preloadSource).toContain('EVENT_CHANNELS.includes(channel)');
		expect([...EVENT_CHANNELS].sort((left, right) => left.localeCompare(right))).toEqual([
			'files:flush-request',
			'files:open-request',
			'kernel:boot-report',
			'menu:command',
			'window:maximized'
		]);
	});
});
