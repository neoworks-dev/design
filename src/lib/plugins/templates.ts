// Starting points for new plugins (the "Create plugin" command). Pure: returns the files of a plugin
// as a map from relative path to text, so main can write them and tests can check them against the
// manifest schema.

export const PLUGIN_TEMPLATES = ['blank', 'panel', 'figma'] as const;
export type PluginTemplateKind = (typeof PLUGIN_TEMPLATES)[number];

export const TEMPLATE_DESCRIPTIONS: Record<PluginTemplateKind, string> = {
	blank: 'A command that logs the selection',
	panel: 'A side panel built with the declarative UI',
	figma: 'A plugin written against the figma API'
};

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The id a plugin name suggests: lower case, words joined by hyphens. */
export function suggestPluginId(name: string): string {
	const words = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (words === '') return '';
	if (/^[0-9]/.test(words)) return `plugin-${words}`;
	return words.slice(0, 64);
}

export function isValidPluginId(id: string): boolean {
	return ID_PATTERN.test(id) && id.length <= 64;
}

function manifestText(manifest: Record<string, unknown>): string {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

function blankFiles(id: string, name: string): Record<string, string> {
	return {
		'manifest.json': manifestText({
			id,
			name,
			version: '0.1.0',
			api: '1.0',
			main: 'main.js',
			permissions: ['document:read', 'selection'],
			contributes: {
				commands: [{ id: `${id}.run`, title: name }],
				menus: [{ menu: 'app/plugins', id: `${id}.run`, command: `${id}.run` }]
			}
		}),
		'main.js': `// ${name} runs in its own worker. Everything it can do goes through \`design\`.
await design.commands.register('${id}.run', async () => {
	const layers = await design.selection.nodes();
	design.log.info(\`\${layers.length} layers selected\`);
});
`
	};
}

function panelFiles(id: string, name: string): Record<string, string> {
	return {
		'manifest.json': manifestText({
			id,
			name,
			version: '0.1.0',
			api: '1.0',
			main: 'main.js',
			permissions: ['document:read', 'document:write', 'ui:panel'],
			contributes: { panels: [{ id: `${id}.panel`, title: name, side: 'right' }] }
		}),
		'main.js': `// ${name}: a panel described as data. The host draws it; clicks come back as functions.
let clicks = 0;

function view() {
	return {
		type: 'stack',
		children: [
			{ type: 'text', text: \`Added \${clicks} rectangles\` },
			{
				type: 'button',
				label: 'Add a rectangle',
				onClick: async () => {
					clicks += 1;
					await design.document.createNode('RECTANGLE', { name: 'From ${name}', width: 80, height: 80 });
					await render();
				}
			}
		]
	};
}

async function render() {
	await design.ui.set('${id}.panel', view());
}

await render();
`
	};
}

function figmaFiles(id: string, name: string): Record<string, string> {
	return {
		'manifest.json': manifestText({
			id,
			name,
			version: '0.1.0',
			api: '1.0',
			main: 'main.js',
			permissions: ['document:read', 'document:write', 'selection'],
			contributes: {
				commands: [{ id: `${id}.run`, title: name }],
				menus: [{ menu: 'app/plugins', id: `${id}.run`, command: `${id}.run` }]
			}
		}),
		'main.js': `// ${name}: Figma plugin code runs as it is. See docs/plugins/figma-compat.md for what is supported.
const rectangle = figma.createRectangle();
rectangle.name = '${name}';
rectangle.resize(120, 80);
rectangle.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.5, b: 1 } }];
figma.currentPage.appendChild(rectangle);
figma.currentPage.selection = [rectangle];
figma.closePlugin('Created a rectangle');
`
	};
}

/** The files of a new plugin: `jsconfig.json` points editors at the typings of \`design\`. */
export function pluginTemplateFiles(
	kind: PluginTemplateKind,
	id: string,
	name: string
): Record<string, string> {
	let files = blankFiles(id, name);
	if (kind === 'panel') files = panelFiles(id, name);
	if (kind === 'figma') files = figmaFiles(id, name);
	return {
		...files,
		'jsconfig.json': `${JSON.stringify(
			{
				compilerOptions: {
					target: 'ES2022',
					module: 'ESNext',
					types: ['@neoworks/plugin-typings']
				},
				include: ['main.js']
			},
			null,
			'\t'
		)}\n`
	};
}
