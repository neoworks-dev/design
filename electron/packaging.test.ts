import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FILE_EXTENSION, FILE_MIME_TYPE, FILE_TYPE_NAME, FILE_UTI } from './store/constants';

// Source-level checks of the packaging config (#140): the document type it registers with the OS
// must be the one the file format defines, and everything the app loads at run time must be
// packaged. The installers themselves are covered by `bun run smoke` and the CI job.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
interface PackageManifest {
	main: string;
	build?: unknown;
}
const manifestText = readFileSync(path.join(root, 'package.json'), 'utf8');
const manifest: PackageManifest = JSON.parse(manifestText);

describe('electron-builder.yml', () => {
	it('is the only place with build settings', () => {
		expect(manifest.build).toBeUndefined();
	});

	it('registers the document type the file format defines', () => {
		expect(config).toContain(`ext: ${FILE_EXTENSION}`);
		expect(config).toContain(`mimeType: ${FILE_MIME_TYPE}`);
		expect(config).toContain(`UTTypeIdentifier: ${FILE_UTI}`);
		expect(config).toContain(`name: ${FILE_TYPE_NAME} document`);
		expect(config).toContain(`- ${FILE_EXTENSION}`);
	});

	it('packages the static build, the main and preload bundles and the manifest entry', () => {
		expect(config).toContain('- build/**/*');
		expect(config).toContain('- electron/dist/**/*');
		expect(manifest.main).toBe('electron/dist/main.js');
	});

	it('targets AppImage and deb, dmg and nsis', () => {
		for (const target of ['AppImage', 'deb', 'dmg', 'nsis']) expect(config).toContain(target);
	});

	it('keeps files the harness starts as processes outside the asar', () => {
		expect(config).toContain('node_modules/@agentclientprotocol/**');
		expect(config).toContain('node_modules/@neoworks/harness/**');
	});

	it('does not publish or auto update by itself', () => {
		expect(config).toMatch(/^publish: null$/m);
	});

	it('does not claim the build directory as buildResources (it is the vite output)', () => {
		expect(config).toMatch(/buildResources: packaging/);
	});
});
