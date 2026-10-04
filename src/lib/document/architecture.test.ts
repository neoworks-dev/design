import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/lib/document must stay pure so it can run in a Web Worker and be unit-tested without the
// kernel: no Svelte, no extension-system, no Electron, no Node built-ins.
// TODO(#13): fold into the shared architecture source tests when they land.

const directory = path.dirname(fileURLToPath(import.meta.url));
const forbiddenSpecifier = /^(svelte|@sveltejs|@neoworks\/|@neoworks-dev\/|electron|node:)/;

function sourceFiles(): string[] {
	return readdirSync(directory).filter(
		(file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.bench.ts')
	);
}

function importedSpecifiers(source: string): string[] {
	const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
	return [...source.matchAll(pattern)].map((match) => match[1]);
}

describe('src/lib/document is import-clean', () => {
	for (const file of sourceFiles()) {
		it(`${file} imports nothing impure`, () => {
			const source = readFileSync(path.join(directory, file), 'utf8');
			const offending = importedSpecifiers(source).filter((specifier) =>
				forbiddenSpecifier.test(specifier)
			);
			expect(offending).toEqual([]);
		});
	}

	it('finds source files to check', () => {
		expect(sourceFiles().length).toBeGreaterThan(3);
	});
});
