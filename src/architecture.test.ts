// Enforces the architecture rules of CLAUDE.md mechanically. Each rule has a test against the
// real source tree (must be clean) and fixtures that violate it (must be reported).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	checkDocumentIsPure,
	checkEffectsAreWrapped,
	checkNoCrossPluginImports,
	checkPluginManifests,
	checkRoutes,
	checkServicesHoldNoState,
	type SourceFile
} from './architecture/rules';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function collectSources(directory: string): SourceFile[] {
	const files: SourceFile[] = [];
	for (const entry of readdirSync(path.join(repositoryRoot, directory), { withFileTypes: true })) {
		const relative = `${directory}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...collectSources(relative));
			continue;
		}
		if (!/\.(ts|svelte)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
		files.push({ path: relative, text: readFileSync(path.join(repositoryRoot, relative), 'utf8') });
	}
	return files;
}

const sources = collectSources('src');

function fixture(filePath: string, text: string): SourceFile[] {
	return [{ path: filePath, text }];
}

describe('routes contain nothing feature-specific', () => {
	it('src/routes imports only kernel boot and RegionHost', () => {
		expect(checkRoutes(sources)).toEqual([]);
	});

	it('flags a route that imports a plugin or a library module', () => {
		const violations = checkRoutes(
			fixture(
				'src/routes/+page.svelte',
				`<script lang="ts">
	import Layers from '../plugins/layers/Panel.svelte';
	import { regions } from '../lib/registries/regions.svelte';
	import RegionHost from '../lib/kernel/RegionHost.svelte';
</script>`
			)
		);
		expect(violations).toHaveLength(2);
		expect(violations[0].line).toBe(2);
	});

	it('accepts the allowed imports', () => {
		const clean = fixture(
			'src/routes/+page.svelte',
			`<script lang="ts">
	import { onMount } from 'svelte';
	import { boot } from '../lib/kernel/app';
	import RegionHost from '../lib/kernel/RegionHost.svelte';
	import './layout.css';
</script>`
		);
		expect(checkRoutes(clean)).toEqual([]);
	});
});

describe('plugin manifests', () => {
	it('every src/plugins/<id>/index.ts declares name = id and inject', () => {
		const manifests = sources.filter((file) => /^src\/plugins\/[^/]+\/index\.ts$/.test(file.path));
		expect(manifests.length).toBeGreaterThan(0);
		expect(checkPluginManifests(sources)).toEqual([]);
	});

	it('flags a wrong name, a missing inject and a non-literal default export', () => {
		const wrongName = checkPluginManifests(
			fixture('src/plugins/a/index.ts', `export default { name: 'b', inject: [], apply() {} };`)
		);
		expect(wrongName.map((entry) => entry.message)).toEqual([
			'plugin name "b" must equal its directory "a"'
		]);

		const noInject = checkPluginManifests(
			fixture('src/plugins/a/index.ts', `export default { name: 'a', apply() {} };`)
		);
		expect(noInject.map((entry) => entry.message)).toEqual([
			'plugin must declare `inject` explicitly, even when empty'
		]);

		const notLiteral = checkPluginManifests(
			fixture('src/plugins/a/index.ts', `const plugin = { name: 'a' };\nexport default plugin;`)
		);
		expect(notLiteral).toHaveLength(1);
	});

	it('accepts an explicit empty inject', () => {
		expect(
			checkPluginManifests(
				fixture('src/plugins/a/index.ts', `export default { name: 'a', inject: [], apply() {} };`)
			)
		).toEqual([]);
	});
});

describe('services hold no state', () => {
	it('no class extending Service uses $state, $derived or #private members', () => {
		expect(checkServicesHoldNoState(sources)).toEqual([]);
	});

	it('flags runes and #private members in a Service subclass', () => {
		const violations = checkServicesHoldNoState(
			fixture(
				'src/lib/registries/bad.svelte.ts',
				`import { Service } from '@neoworks/extension-system';
class Bad extends Service {
	count = $state(0);
	items = $state.raw([]);
	#secret = 1;
}
class Fine {
	count = $state(0);
}`
			)
		);
		expect(violations.map((entry) => entry.line)).toEqual([3, 4, 5]);
	});
});

describe('side effects live in ctx.effect', () => {
	it('plugin code never registers raw listeners, timers or handlers outside ctx.effect', () => {
		expect(checkEffectsAreWrapped(sources)).toEqual([]);
	});

	it('flags bare effects in a plugin and in a component script', () => {
		const plugin = checkEffectsAreWrapped(
			fixture(
				'src/plugins/a/index.ts',
				`export default {
	name: 'a',
	inject: [],
	apply(ctx) {
		window.addEventListener('keydown', handler);
		setInterval(tick, 10);
		setTimeout(tick, 10);
		ipcMain.handle('x', handler);
		ctx.effect(() => {
			window.addEventListener('keyup', handler);
			return () => window.removeEventListener('keyup', handler);
		}, 'ok');
	}
};`
			)
		);
		expect(plugin.map((entry) => entry.line)).toEqual([5, 6, 7, 8]);

		const component = checkEffectsAreWrapped(
			fixture(
				'src/plugins/a/Panel.svelte',
				`<script lang="ts">
	const observer = new ResizeObserver(() => {});
</script>
<div></div>`
			)
		);
		expect(component.map((entry) => entry.line)).toEqual([2]);
	});

	it('accepts effects wrapped in ctx.effect and ignores code outside plugins', () => {
		const wrapped = fixture(
			'src/plugins/a/index.ts',
			`export default { name: 'a', inject: [], apply(ctx) {
	ctx.effect(() => {
		const timer = setInterval(tick, 10);
		return () => clearInterval(timer);
	}, 'timer');
} };`
		);
		expect(checkEffectsAreWrapped(wrapped)).toEqual([]);
		expect(
			checkEffectsAreWrapped(fixture('src/lib/kernel/testing.ts', `setInterval(tick, 10);`))
		).toEqual([]);
	});
});

describe('src/lib/document stays pure', () => {
	it('imports neither svelte, the kernel nor electron', () => {
		expect(checkDocumentIsPure(sources)).toEqual([]);
	});

	it('flags forbidden imports', () => {
		const violations = checkDocumentIsPure(
			fixture(
				'src/lib/document/nodes.ts',
				`import { Context } from '@neoworks/extension-system';
import { flushSync } from 'svelte';
import { app } from 'electron';
import { z } from 'zod';
import { helper } from './helper';`
			)
		);
		expect(violations.map((entry) => entry.line)).toEqual([1, 2, 3]);
	});
});

describe('no singletons imported across plugins', () => {
	it('plugins and the library never import another plugin', () => {
		expect(checkNoCrossPluginImports(sources)).toEqual([]);
	});

	it('flags a value import of another plugin but allows type imports', () => {
		const files: SourceFile[] = [
			{
				path: 'src/plugins/layers/index.ts',
				text: `import { panelState } from '../selection/state';
import type { SelectionService } from '../selection/service';
import { own } from './own';`
			},
			{
				path: 'src/lib/kernel/RegionHost.ts',
				text: `import coreRegions from '../../plugins/core-regions';`
			}
		];
		const violations = checkNoCrossPluginImports(files);
		expect(violations.map((entry) => `${entry.file}:${entry.line}`)).toEqual([
			'src/plugins/layers/index.ts:1',
			'src/lib/kernel/RegionHost.ts:1'
		]);
	});
});
