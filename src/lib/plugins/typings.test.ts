import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packageDirectory = path.resolve('packages/plugin-typings');

function diagnosticsOf(file: string): string[] {
	const program = ts.createProgram([path.join(packageDirectory, 'index.d.ts'), file], {
		noEmit: true,
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
		types: []
	});
	return ts
		.getPreEmitDiagnostics(program)
		.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('@neoworks/plugin-typings', () => {
	it('compiles a TypeScript plugin that uses the design API', () => {
		expect(diagnosticsOf(path.join(packageDirectory, 'examples/hello.ts'))).toEqual([]);
	});

	it('rejects a call the API does not have, so the typings are real', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'plugin-typings-'));
		try {
			const wrong = path.join(directory, 'wrong.ts');
			writeFileSync(
				wrong,
				"export {};\nawait design.documents.nope();\nawait design.storage.setData(1, 'k', 'v');\n"
			);
			const messages = diagnosticsOf(wrong);
			expect(messages.some((message) => message.includes("'documents' does not exist"))).toBe(true);
			expect(messages.some((message) => message.includes("'number' is not assignable"))).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('ships a manifest schema generated from the app schema', () => {
		const schema = JSON.parse(
			readFileSync(path.join(packageDirectory, 'manifest.schema.json'), 'utf8')
		);
		expect(schema.properties.permissions.items.enum).toContain('storage');
		expect(schema.required).toEqual(
			expect.arrayContaining(['id', 'name', 'version', 'api', 'main'])
		);
	});

	it('is up to date with the API definitions', { timeout: 60_000 }, () => {
		const output = execFileSync('bun', ['scripts/plugin-typings.ts', '--check'], {
			encoding: 'utf8'
		});
		expect(output).toContain('up to date');
	});
});
