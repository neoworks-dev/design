import { describe, expect, it } from 'vitest';
import { checkApiCompatibility, parseManifest, PLUGIN_API_VERSION } from './manifest';
import { validManifest } from './fixtures/pluginFixture';

function errorsOf(input: unknown): { path: string; message: string }[] {
	const result = parseManifest(input);
	if (result.ok) throw new Error('expected the manifest to be rejected');
	return result.errors;
}

describe('parseManifest', () => {
	it('accepts a minimal manifest and fills in defaults', () => {
		const result = parseManifest({
			id: 'tiny',
			name: 'Tiny',
			version: '0.1.0',
			api: '1.0',
			main: 'main.js'
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.permissions).toEqual([]);
		expect(result.manifest.editorType).toEqual(['design']);
		expect(result.manifest.contributes.commands).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('accepts every contribution kind', () => {
		const result = parseManifest(
			validManifest({
				contributes: {
					commands: [{ id: 'example.run', title: 'Run', when: 'hasSelection' }],
					menus: [{ menu: 'app/plugins', id: 'example.run', command: 'example.run' }],
					keybindings: [{ key: 'Mod+Shift+E', command: 'example.run' }],
					tools: [{ id: 'example.brush', title: 'Brush', shortcut: 'B' }],
					panels: [{ id: 'example.panel', title: 'Example', side: 'right' }],
					inspectors: [{ id: 'example.section', title: 'Example', nodeTypes: ['RECTANGLE'] }],
					aiTools: [{ id: 'example_count', description: 'Count layers', write: false }],
					codegen: [{ id: 'example.swift', label: 'Swift' }]
				}
			})
		);
		expect(result.ok).toBe(true);
	});

	it('rejects with the path of every broken field', () => {
		const errors = errorsOf({
			id: 'Bad Id',
			name: '',
			version: 'one',
			api: '1',
			main: '../escape.js',
			permissions: ['telepathy'],
			contributes: { commands: [{ id: 'example.run' }] }
		});
		const paths = errors.map((issue) => issue.path);
		expect(paths).toEqual(
			expect.arrayContaining([
				'id',
				'name',
				'version',
				'api',
				'main',
				'permissions[0]',
				'contributes.commands[0].title'
			])
		);
		for (const issue of errors) expect(issue.message.length).toBeGreaterThan(0);
	});

	it('rejects unknown keys instead of ignoring them', () => {
		const errors = errorsOf(validManifest({ permisions: [] }));
		expect(errors[0].message).toContain('permisions');
	});

	it('requires contributed ids to carry the plugin id as prefix', () => {
		const errors = errorsOf(
			validManifest({
				contributes: {
					commands: [{ id: 'other.run', title: 'Run' }],
					aiTools: [{ id: 'example.count', description: 'x' }]
				}
			})
		);
		expect(errors).toEqual([
			{ path: 'contributes.commands[0].id', message: expect.stringContaining('"example."') },
			{ path: 'contributes.aiTools[0].id', message: expect.stringContaining('"example_"') }
		]);
	});

	it('rejects duplicate ids within a kind', () => {
		const errors = errorsOf(
			validManifest({
				contributes: {
					commands: [
						{ id: 'example.run', title: 'A' },
						{ id: 'example.run', title: 'B' }
					]
				}
			})
		);
		expect(errors).toEqual([
			{ path: 'contributes.commands[1].id', message: '"example.run" is declared twice' }
		]);
	});

	it('warns about the reserved ui field and about network domains without the permission', () => {
		const result = parseManifest(
			validManifest({ ui: 'ui.html', networkAccess: { allowedDomains: ['api.example.com'] } })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.warnings).toHaveLength(2);
	});
});

describe('checkApiCompatibility', () => {
	it('accepts the same version silently', () => {
		expect(checkApiCompatibility(PLUGIN_API_VERSION)).toEqual({
			compatible: true,
			error: null,
			warnings: []
		});
	});

	it('refuses another major version with a clear error', () => {
		const result = checkApiCompatibility('2.0', '1.3');
		expect(result.compatible).toBe(false);
		expect(result.error).toContain('2.0');
		expect(result.error).toContain('1.3');
	});

	it('refuses a newer minor version and tells the user to update', () => {
		const result = checkApiCompatibility('1.4', '1.2');
		expect(result.compatible).toBe(false);
		expect(result.error).toContain('update the app');
	});

	it('runs an older minor version with a warning', () => {
		const result = checkApiCompatibility('1.0', '1.2');
		expect(result.compatible).toBe(true);
		expect(result.warnings).toHaveLength(1);
	});
});
