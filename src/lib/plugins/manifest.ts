// The manifest of a third-party plugin (`manifest.json`), as a schema, and the rules that need
// more than a schema: contributed ids carry the plugin's id as prefix (CLAUDE.md: keys of
// plugin-provided things are prefixed with the plugin id), and the plugin's `api` version must be
// one this app provides.
//
// Pure: used by the renderer's `plugin-manifests` plugin and by tests, runs anywhere.
//
// Fields follow docs/research/plugin-api.md section 1 (Figma) and section 3 (this app): `name`,
// `id`, `version`, `api`, `main`, `ui`, `permissions`, `networkAccess`, `contributes`,
// `editorType`, `build`.

import { z } from 'zod';

/** The plugin API this app provides: `<major>.<minor>`. Plugins declare the one they were written for. */
export const PLUGIN_API_VERSION = '1.0';

/** What a plugin may be allowed to do (research section 3 point 3); enforced by #158. */
export const PLUGIN_PERMISSIONS = [
	'document:read',
	'document:write',
	'selection',
	'network',
	'fs',
	'clipboard',
	'ai',
	'ui:panel',
	'ui:tool',
	'storage'
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PLUGIN_EDITOR_TYPES = ['design', 'dev'] as const;
export type PluginEditorType = (typeof PLUGIN_EDITOR_TYPES)[number];

const pluginId = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/, 'lower-case letters, digits and hyphens, starting with a letter')
	.max(64);
const relativePath = z
	.string()
	.min(1)
	.refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
		message: 'must be a relative path inside the plugin directory'
	});
const contextExpression = z.string().min(1);

const commandContribution = z.strictObject({
	id: z.string().min(1),
	title: z.string().min(1),
	when: contextExpression.optional()
});
const menuContribution = z.strictObject({
	/** Menu path, for example `app/plugins` or `context/layer`. */
	menu: z.string().min(1),
	id: z.string().min(1),
	command: z.string().min(1),
	title: z.string().min(1).optional(),
	group: z.string().optional(),
	order: z.number().optional(),
	when: contextExpression.optional()
});
const keybindingContribution = z.strictObject({
	key: z.string().min(1),
	command: z.string().min(1),
	when: contextExpression.optional(),
	scope: z.string().min(1).optional()
});
const toolContribution = z.strictObject({
	id: z.string().min(1),
	title: z.string().min(1),
	shortcut: z.string().min(1).optional(),
	cursor: z.string().min(1).optional()
});
const panelContribution = z.strictObject({
	id: z.string().min(1),
	title: z.string().min(1),
	side: z.enum(['left', 'right']).default('right'),
	shortcut: z.string().min(1).optional(),
	when: contextExpression.optional()
});
const inspectorContribution = z.strictObject({
	id: z.string().min(1),
	title: z.string().min(1),
	/** Tab the section stacks in. */
	tab: z.string().min(1).default('design'),
	/** Node types the section applies to; absent means any selection. */
	nodeTypes: z.array(z.string().min(1)).min(1).optional(),
	order: z.number().optional()
});
const aiToolContribution = z.strictObject({
	/** The tool name the model sees. */
	id: z.string().min(1),
	description: z.string().min(1).max(4000),
	inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
	write: z.boolean().default(false)
});
const codegenContribution = z.strictObject({
	id: z.string().min(1),
	label: z.string().min(1)
});

const contributesSchema = z.strictObject({
	commands: z.array(commandContribution).default([]),
	menus: z.array(menuContribution).default([]),
	keybindings: z.array(keybindingContribution).default([]),
	tools: z.array(toolContribution).default([]),
	panels: z.array(panelContribution).default([]),
	inspectors: z.array(inspectorContribution).default([]),
	aiTools: z.array(aiToolContribution).default([]),
	codegen: z.array(codegenContribution).default([])
});

const networkAccessSchema = z.strictObject({
	/** Hosts the plugin may reach, for example `api.example.com`; enforced by #158. */
	allowedDomains: z.array(z.string().min(1)).default([]),
	reasoning: z.string().optional()
});

export const pluginManifestSchema = z.strictObject({
	id: pluginId,
	name: z.string().min(1).max(100),
	version: z
		.string()
		.regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, 'a semantic version, e.g. 1.0.0'),
	description: z.string().max(1000).optional(),
	/** The plugin API version the plugin was written for, `<major>.<minor>`. */
	api: z.string().regex(/^\d+\.\d+$/, 'a version like "1.0"'),
	/** The plugin's module, bundled to one file; runs in the worker. */
	main: relativePath,
	/** Reserved: v1 has no HTML iframe, plugin UI is a declarative surface (`design.ui`). */
	ui: z.union([relativePath, z.record(z.string(), relativePath)]).optional(),
	permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).default([]),
	networkAccess: networkAccessSchema.optional(),
	contributes: contributesSchema.default(() => contributesSchema.parse({})),
	editorType: z.array(z.enum(PLUGIN_EDITOR_TYPES)).min(1).default(['design']),
	/** Shell command a development workflow runs before loading (#162). */
	build: z.string().min(1).optional()
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginContributes = PluginManifest['contributes'];

export interface ManifestIssue {
	/** Path into the manifest, for example `contributes.commands[0].id`; empty for the root. */
	path: string;
	message: string;
}

export type ManifestResult =
	| { ok: true; manifest: PluginManifest; warnings: string[] }
	| { ok: false; errors: ManifestIssue[] };

function formatPath(segments: readonly PropertyKey[]): string {
	let result = '';
	for (const segment of segments) {
		if (typeof segment === 'number') result += `[${segment}]`;
		else if (result === '') result = String(segment);
		else result += `.${String(segment)}`;
	}
	return result;
}

function schemaIssues(error: z.ZodError): ManifestIssue[] {
	return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

function prefixIssue(path: string, id: string, prefix: string): ManifestIssue {
	return { path, message: `"${id}" must start with "${prefix}" (the plugin's id)` };
}

/** Contributed ids are prefixed with the plugin id so two plugins can never claim the same one. */
function checkPrefixes(manifest: PluginManifest): ManifestIssue[] {
	const issues: ManifestIssue[] = [];
	const dotted = `${manifest.id}.`;
	// AI tool names are what a model calls: letters, digits, `_` and `-` only, so no dot.
	const underscored = `${manifest.id}_`;
	const { contributes } = manifest;
	const checks: [string, { id: string }[], string][] = [
		['contributes.commands', contributes.commands, dotted],
		['contributes.tools', contributes.tools, dotted],
		['contributes.panels', contributes.panels, dotted],
		['contributes.inspectors', contributes.inspectors, dotted],
		['contributes.aiTools', contributes.aiTools, underscored],
		['contributes.codegen', contributes.codegen, dotted]
	];
	for (const [base, entries, prefix] of checks) {
		entries.forEach((entry, index) => {
			if (!entry.id.startsWith(prefix))
				issues.push(prefixIssue(`${base}[${index}].id`, entry.id, prefix));
		});
	}
	contributes.menus.forEach((entry, index) => {
		if (!entry.id.startsWith(dotted)) {
			issues.push(prefixIssue(`contributes.menus[${index}].id`, entry.id, dotted));
		}
	});
	return issues;
}

function checkDuplicateIds(manifest: PluginManifest): ManifestIssue[] {
	const issues: ManifestIssue[] = [];
	const groups: [string, string[]][] = [
		['commands', manifest.contributes.commands.map((entry) => entry.id)],
		['tools', manifest.contributes.tools.map((entry) => entry.id)],
		['panels', manifest.contributes.panels.map((entry) => entry.id)],
		['inspectors', manifest.contributes.inspectors.map((entry) => entry.id)],
		['aiTools', manifest.contributes.aiTools.map((entry) => entry.id)],
		['codegen', manifest.contributes.codegen.map((entry) => entry.id)]
	];
	for (const [name, ids] of groups) {
		ids.forEach((id, index) => {
			if (ids.indexOf(id) !== index) {
				issues.push({
					path: `contributes.${name}[${index}].id`,
					message: `"${id}" is declared twice`
				});
			}
		});
	}
	return issues;
}

function warningsOf(manifest: PluginManifest): string[] {
	const warnings: string[] = [];
	if (manifest.ui !== undefined) {
		warnings.push(
			'"ui" is ignored: API 1 has no HTML iframe, build the UI with design.ui surfaces'
		);
	}
	const { networkAccess, permissions } = manifest;
	if (
		networkAccess &&
		networkAccess.allowedDomains.length > 0 &&
		!permissions.includes('network')
	) {
		warnings.push('"networkAccess" lists domains but "permissions" lacks "network"');
	}
	return warnings;
}

/** Validate parsed JSON as a manifest. Errors carry the path of every offending field. */
export function parseManifest(input: unknown): ManifestResult {
	const parsed = pluginManifestSchema.safeParse(input);
	if (!parsed.success) return { ok: false, errors: schemaIssues(parsed.error) };
	const issues = [...checkPrefixes(parsed.data), ...checkDuplicateIds(parsed.data)];
	if (issues.length > 0) return { ok: false, errors: issues };
	return { ok: true, manifest: parsed.data, warnings: warningsOf(parsed.data) };
}

export interface ApiCompatibility {
	compatible: boolean;
	/** A clear sentence when not compatible, otherwise `null`. */
	error: string | null;
	warnings: string[];
}

function parseApiVersion(version: string): { major: number; minor: number } {
	const [major, minor] = version.split('.').map(Number);
	return { major, minor };
}

/**
 * Whether a plugin written for `pluginApi` runs on this app: the major version must match, and the
 * plugin may not need a newer minor than the app provides. An older minor works (the API only
 * grows within a major) and says so as a warning.
 */
export function checkApiCompatibility(
	pluginApi: string,
	hostApi: string = PLUGIN_API_VERSION
): ApiCompatibility {
	const wanted = parseApiVersion(pluginApi);
	const provided = parseApiVersion(hostApi);
	if (wanted.major !== provided.major) {
		return {
			compatible: false,
			error: `needs plugin API ${pluginApi}, this app provides ${hostApi} (major versions differ)`,
			warnings: []
		};
	}
	if (wanted.minor > provided.minor) {
		return {
			compatible: false,
			error: `needs plugin API ${pluginApi}, this app only provides ${hostApi}: update the app`,
			warnings: []
		};
	}
	if (wanted.minor < provided.minor) {
		return {
			compatible: true,
			error: null,
			warnings: [`written for plugin API ${pluginApi}, this app provides ${hostApi}`]
		};
	}
	return { compatible: true, error: null, warnings: [] };
}
