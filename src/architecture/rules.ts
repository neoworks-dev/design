// Source-level architecture rules from CLAUDE.md, as pure functions over source texts so each
// rule can be tested against both the real tree and a fixture that violates it.
// Run by src/architecture.test.ts.

import path from 'node:path';
import ts from 'typescript';

export interface SourceFile {
	/** Path relative to the repository root, forward slashes: `src/plugins/x/index.ts`. */
	path: string;
	text: string;
}

export interface Violation {
	rule: string;
	file: string;
	line: number;
	message: string;
}

// --- Parsing helpers ---------------------------------------------------------------------

function isSvelteComponent(file: SourceFile): boolean {
	return file.path.endsWith('.svelte');
}

function scriptSources(file: SourceFile): { text: string; lineOffset: number }[] {
	if (!isSvelteComponent(file)) return [{ text: file.text, lineOffset: 0 }];
	const blocks: { text: string; lineOffset: number }[] = [];
	for (const match of file.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
		const before = file.text.slice(0, match.index);
		blocks.push({ text: match[1], lineOffset: before.split('\n').length - 1 });
	}
	return blocks;
}

function parse(text: string): ts.SourceFile {
	return ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node, lineOffset: number): number {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 + lineOffset;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
	visit(node);
	ts.forEachChild(node, (child) => walk(child, visit));
}

function isTestFile(filePath: string): boolean {
	return filePath.endsWith('.test.ts') || filePath.includes('/fixtures/');
}

interface ImportRecord {
	specifier: string;
	typeOnly: boolean;
	line: number;
}

function importsOf(file: SourceFile): ImportRecord[] {
	const records: ImportRecord[] = [];
	for (const block of scriptSources(file)) {
		const sourceFile = parse(block.text);
		walk(sourceFile, (node) => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				records.push({
					specifier: node.moduleSpecifier.text,
					typeOnly: node.importClause?.isTypeOnly === true,
					line: lineOf(sourceFile, node, block.lineOffset)
				});
			}
			if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
				records.push({
					specifier: (node.moduleSpecifier as ts.StringLiteral).text,
					typeOnly: node.isTypeOnly,
					line: lineOf(sourceFile, node, block.lineOffset)
				});
			}
		});
	}
	return records;
}

/** Repo-relative path an import resolves to, or undefined for packages and aliases. */
function resolveImport(fromFile: string, specifier: string): string | undefined {
	if (!specifier.startsWith('.')) return undefined;
	return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
}

function violation(rule: string, file: string, line: number, message: string): Violation {
	return { rule, file, line, message };
}

// --- Rule: routes know only kernel boot and RegionHost ----------------------------------

const ROUTE_ALLOWED_TARGETS = [
	'src/lib/kernel/app',
	'src/lib/kernel/context',
	'src/lib/kernel/RegionHost.svelte'
];
const ROUTE_ALLOWED_PACKAGES = [/^svelte(\/|$)/, /^\$app\//, /^@sveltejs\//];

export function checkRoutes(files: SourceFile[]): Violation[] {
	const rule = 'routes-are-feature-free';
	const violations: Violation[] = [];
	for (const file of files) {
		if (!file.path.startsWith('src/routes/') || isTestFile(file.path)) continue;
		for (const record of importsOf(file)) {
			if (record.specifier.endsWith('.css')) continue;
			if (ROUTE_ALLOWED_PACKAGES.some((pattern) => pattern.test(record.specifier))) continue;
			const target = resolveImport(file.path, record.specifier);
			if (target && target.startsWith('src/routes/')) continue;
			if (target && ROUTE_ALLOWED_TARGETS.includes(target)) continue;
			violations.push(
				violation(
					rule,
					file.path,
					record.line,
					`routes may import only kernel boot, getKernel/provideKernel and RegionHost, not "${record.specifier}"`
				)
			);
		}
	}
	return violations;
}

// --- Rule: every plugin declares name (= directory id) and inject ------------------------

function exportedObjectLiteral(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
	for (const statement of sourceFile.statements) {
		if (!ts.isExportAssignment(statement)) continue;
		if (ts.isObjectLiteralExpression(statement.expression)) return statement.expression;
	}
	return undefined;
}

function propertyNamed(
	literal: ts.ObjectLiteralExpression,
	name: string
): ts.ObjectLiteralElementLike | undefined {
	return literal.properties.find(
		(property) => property.name !== undefined && property.name.getText() === name
	);
}

export function checkPluginManifests(files: SourceFile[]): Violation[] {
	const rule = 'plugin-declares-name-and-inject';
	const violations: Violation[] = [];
	for (const file of files) {
		const match = /^src\/plugins\/([^/]+)\/index\.ts$/.exec(file.path);
		if (!match) continue;
		const id = match[1];
		const literal = exportedObjectLiteral(parse(file.text));
		if (!literal) {
			violations.push(
				violation(
					rule,
					file.path,
					1,
					'default export must be an object literal { name, inject, apply }'
				)
			);
			continue;
		}
		const name = propertyNamed(literal, 'name');
		if (!name || !ts.isPropertyAssignment(name) || !ts.isStringLiteral(name.initializer)) {
			violations.push(violation(rule, file.path, 1, 'plugin must declare a string literal `name`'));
		} else if (name.initializer.text !== id) {
			violations.push(
				violation(
					rule,
					file.path,
					1,
					`plugin name "${name.initializer.text}" must equal its directory "${id}"`
				)
			);
		}
		if (!propertyNamed(literal, 'inject')) {
			violations.push(
				violation(rule, file.path, 1, 'plugin must declare `inject` explicitly, even when empty')
			);
		}
	}
	return violations;
}

// --- Rule: services hold no runes and no #private members --------------------------------

const RUNE_NAMES = ['$state', '$derived', '$effect'];

function extendsService(node: ts.ClassDeclaration): boolean {
	return (node.heritageClauses ?? []).some(
		(clause) =>
			clause.token === ts.SyntaxKind.ExtendsKeyword &&
			clause.types.some((type) => type.expression.getText() === 'Service')
	);
}

function isRuneCall(node: ts.Node): boolean {
	if (!ts.isCallExpression(node)) return false;
	const callee = node.expression.getText();
	return RUNE_NAMES.some((rune) => callee === rune || callee.startsWith(`${rune}.`));
}

export function checkServicesHoldNoState(files: SourceFile[]): Violation[] {
	const rule = 'service-no-state';
	const violations: Violation[] = [];
	for (const file of files) {
		if (!file.path.startsWith('src/') || isTestFile(file.path) || isSvelteComponent(file)) continue;
		const sourceFile = parse(file.text);
		walk(sourceFile, (node) => {
			if (!ts.isClassDeclaration(node) || !extendsService(node)) return;
			const className = node.name?.getText() ?? 'anonymous';
			walk(node, (inner) => {
				if (isRuneCall(inner)) {
					violations.push(
						violation(
							rule,
							file.path,
							lineOf(sourceFile, inner, 0),
							`Service "${className}" must not use ${inner.getText().split('(')[0]}: keep runes in a registry (isolate/intercept rebuild services with Object.create)`
						)
					);
				}
				if (ts.isPrivateIdentifier(inner)) {
					violations.push(
						violation(
							rule,
							file.path,
							lineOf(sourceFile, inner, 0),
							`Service "${className}" must not use ${inner.text}: #private members throw through the kernel proxy, use TS \`private\``
						)
					);
				}
			});
		});
	}
	return violations;
}

// --- Rule: side effects only inside ctx.effect in plugin code ----------------------------

interface EffectfulCall {
	description: string;
	matches: (node: ts.Node) => boolean;
}

function callTo(node: ts.Node, target: string): boolean {
	return ts.isCallExpression(node) && node.expression.getText() === target;
}

const EFFECTFUL: EffectfulCall[] = [
	{
		description: 'window.addEventListener',
		matches: (node) => callTo(node, 'window.addEventListener')
	},
	{
		description: 'document.addEventListener',
		matches: (node) => callTo(node, 'document.addEventListener')
	},
	{ description: 'setInterval', matches: (node) => callTo(node, 'setInterval') },
	{ description: 'setTimeout', matches: (node) => callTo(node, 'setTimeout') },
	{ description: 'ipcMain.handle', matches: (node) => callTo(node, 'ipcMain.handle') },
	{
		description: 'new ResizeObserver',
		matches: (node) => ts.isNewExpression(node) && node.expression.getText() === 'ResizeObserver'
	},
	{
		description: 'new MutationObserver',
		matches: (node) => ts.isNewExpression(node) && node.expression.getText() === 'MutationObserver'
	}
];

function isInsideEffectCall(node: ts.Node): boolean {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (!ts.isCallExpression(parent)) continue;
		const callee = parent.expression;
		if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'effect') return true;
		if (ts.isIdentifier(callee) && callee.text === 'effect') return true;
	}
	return false;
}

export function checkEffectsAreWrapped(files: SourceFile[]): Violation[] {
	const rule = 'side-effects-in-ctx-effect';
	const violations: Violation[] = [];
	for (const file of files) {
		if (!file.path.startsWith('src/plugins/') || isTestFile(file.path)) continue;
		if (!/\.(ts|svelte)$/.test(file.path)) continue;
		for (const block of scriptSources(file)) {
			const sourceFile = parse(block.text);
			walk(sourceFile, (node) => {
				const effectful = EFFECTFUL.find((candidate) => candidate.matches(node));
				if (!effectful || isInsideEffectCall(node)) return;
				violations.push(
					violation(
						rule,
						file.path,
						lineOf(sourceFile, node, block.lineOffset),
						`${effectful.description} must run inside ctx.effect with its inverse as the return value`
					)
				);
			});
		}
	}
	return violations;
}

// --- Rule: src/lib/document stays pure ---------------------------------------------------

const DOCUMENT_FORBIDDEN = [
	/^svelte(\/|$)/,
	/^@neoworks\/extension-system(\/|$)/,
	/^electron(\/|$)/
];

export function checkDocumentIsPure(files: SourceFile[]): Violation[] {
	const rule = 'document-is-pure';
	const violations: Violation[] = [];
	for (const file of files) {
		if (!file.path.startsWith('src/lib/document/')) continue;
		for (const record of importsOf(file)) {
			if (!DOCUMENT_FORBIDDEN.some((pattern) => pattern.test(record.specifier))) continue;
			violations.push(
				violation(
					rule,
					file.path,
					record.line,
					`src/lib/document must stay pure: it may not import "${record.specifier}"`
				)
			);
		}
	}
	return violations;
}

// --- Rule: no singletons imported across plugins -----------------------------------------

function pluginOf(filePath: string): string | undefined {
	return /^src\/plugins\/([^/]+)\//.exec(filePath)?.[1];
}

export function checkNoCrossPluginImports(files: SourceFile[]): Violation[] {
	const rule = 'no-cross-plugin-imports';
	const violations: Violation[] = [];
	for (const file of files) {
		if (isTestFile(file.path)) continue;
		const owner = pluginOf(file.path);
		const isLibrary = file.path.startsWith('src/lib/');
		if (!owner && !isLibrary) continue;
		for (const record of importsOf(file)) {
			const target = resolveImport(file.path, record.specifier);
			if (!target) continue;
			const targetPlugin = pluginOf(`${target}/`);
			if (!targetPlugin || targetPlugin === owner) continue;
			if (owner && record.typeOnly) continue;
			violations.push(
				violation(
					rule,
					file.path,
					record.line,
					`import of "${record.specifier}" reaches into plugin "${targetPlugin}": declare \`inject\` and use ctx.<service> instead`
				)
			);
		}
	}
	return violations;
}

export const ALL_RULES: Record<string, (files: SourceFile[]) => Violation[]> = {
	routes: checkRoutes,
	pluginManifests: checkPluginManifests,
	serviceNoState: checkServicesHoldNoState,
	effectsWrapped: checkEffectsAreWrapped,
	documentPure: checkDocumentIsPure,
	crossPluginImports: checkNoCrossPluginImports
};
