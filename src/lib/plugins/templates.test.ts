import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest';
import {
	isValidPluginId,
	PLUGIN_TEMPLATES,
	pluginTemplateFiles,
	suggestPluginId
} from './templates';

describe('plugin templates', () => {
	for (const kind of PLUGIN_TEMPLATES) {
		it(`the ${kind} template is a valid plugin: manifest passes the schema, main exists`, () => {
			const files = pluginTemplateFiles(kind, 'my-tool', 'My Tool');
			expect(Object.keys(files)).toEqual(['manifest.json', 'main.js', 'jsconfig.json']);
			const result = parseManifest(JSON.parse(files['manifest.json']));
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.manifest).toMatchObject({ id: 'my-tool', name: 'My Tool', main: 'main.js' });
			expect(result.warnings).toEqual([]);
			expect(files['main.js']).toMatch(/my-tool|My Tool/);
		});
	}

	it('names the ids contributed things carry after the plugin id', () => {
		const files = pluginTemplateFiles('panel', 'my-tool', 'My Tool');
		expect(files['main.js']).toContain("design.ui.set('my-tool.panel'");
		expect(files['manifest.json']).toContain('"my-tool.panel"');
	});

	it('suggests a valid id from a name', () => {
		expect(suggestPluginId('My Tool!')).toBe('my-tool');
		expect(suggestPluginId('3D Helper')).toBe('plugin-3d-helper');
		expect(suggestPluginId('!!')).toBe('');
		expect(isValidPluginId('my-tool')).toBe(true);
		expect(isValidPluginId('My Tool')).toBe(false);
	});
});
