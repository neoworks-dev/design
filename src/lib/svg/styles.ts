// Style resolution for the SVG importer (#106): presentation attributes, `<style>` rules with
// simple selectors, the `style` attribute and inheritance. Values stay strings; the importer reads
// them where it needs them.

export type StyleMap = Record<string, string>;

/** Properties a child takes from its parent unless it sets them itself. */
const INHERITED = new Set([
	'fill',
	'fill-opacity',
	'fill-rule',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-miterlimit',
	'stroke-dasharray',
	'color',
	'font-family',
	'font-size',
	'font-weight',
	'font-style',
	'text-anchor',
	'visibility'
]);

/** Everything a rule or attribute may set that the importer reads. */
const PROPERTIES = new Set([
	...INHERITED,
	'opacity',
	'display',
	'stop-color',
	'stop-opacity',
	'clip-path',
	'mask',
	'filter'
]);

export interface CssRule {
	selector: string;
	declarations: StyleMap;
}

function parseDeclarations(source: string): StyleMap {
	const declarations: StyleMap = {};
	for (const part of source.split(';')) {
		const colon = part.indexOf(':');
		if (colon < 0) continue;
		const name = part.slice(0, colon).trim().toLowerCase();
		const value = part
			.slice(colon + 1)
			.replace(/!important/i, '')
			.trim();
		if (name !== '' && value !== '') declarations[name] = value;
	}
	return declarations;
}

/** Rules of a `<style>` element; selectors with combinators or pseudo classes are skipped. */
export function parseStyleSheet(source: string): CssRule[] {
	const rules: CssRule[] = [];
	const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const declarations = parseDeclarations(match[2]);
		for (const selector of match[1].split(',')) {
			const trimmed = selector.trim();
			if (trimmed === '' || /[\s>+~:[]/.test(trimmed)) continue;
			rules.push({ selector: trimmed, declarations });
		}
	}
	return rules;
}

function matches(selector: string, element: Element): boolean {
	if (selector === '*') return true;
	const parts = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/.exec(selector);
	if (parts === null) return false;
	const [, tag, id, classes] = parts;
	if (tag !== undefined && tag.toLowerCase() !== element.localName.toLowerCase()) return false;
	if (id !== undefined && element.getAttribute('id') !== id) return false;
	const classList = (element.getAttribute('class') ?? '').split(/\s+/);
	for (const className of classes.split('.').filter((name) => name !== '')) {
		if (!classList.includes(className)) return false;
	}
	return true;
}

/** The properties an element sets itself, attributes first, then rules, then `style`. */
export function ownStyle(element: Element, rules: readonly CssRule[]): StyleMap {
	const style: StyleMap = {};
	for (const name of PROPERTIES) {
		const value = element.getAttribute(name);
		if (value !== null && value.trim() !== '') style[name] = value.trim();
	}
	for (const rule of rules) {
		if (matches(rule.selector, element)) Object.assign(style, rule.declarations);
	}
	Object.assign(style, parseDeclarations(element.getAttribute('style') ?? ''));
	return style;
}

/** `own` laid over what `parent` passes down. */
export function computedStyle(parent: StyleMap, own: StyleMap): StyleMap {
	const style: StyleMap = {};
	for (const [name, value] of Object.entries(parent)) {
		if (INHERITED.has(name)) style[name] = value;
	}
	Object.assign(style, own);
	return style;
}
