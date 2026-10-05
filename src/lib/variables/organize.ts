// Pure helpers for the variables UI: slash-path grouping, scope lists and which variables a
// bindable field may offer (data-model.md section 4: scopes are enforced in the picker only).

import type { Variable, VariableType } from '../document';

export interface VariableGroup {
	/** Slash path of the group without the variable name; empty for variables at the top. */
	path: string;
	variables: Variable[];
}

/** Everything before the last slash of a variable name. */
export function groupPathOf(name: string): string {
	const slash = name.lastIndexOf('/');
	if (slash < 0) return '';
	return name.slice(0, slash);
}

/** The last segment of a variable name. */
export function leafNameOf(name: string): string {
	const slash = name.lastIndexOf('/');
	if (slash < 0) return name;
	return name.slice(slash + 1);
}

/** Groups in order of first appearance, top level first; variables keep their order. */
export function groupVariables(variables: readonly Variable[]): VariableGroup[] {
	const groups = new Map<string, Variable[]>();
	for (const variable of variables) {
		const path = groupPathOf(variable.name);
		const members = groups.get(path);
		if (members === undefined) groups.set(path, [variable]);
		else members.push(variable);
	}
	const ordered = [...groups.entries()].map(([path, members]) => ({ path, variables: members }));
	return ordered.sort((left, right) => {
		if (left.path === '') return -1;
		if (right.path === '') return 1;
		return 0;
	});
}

export const SCOPES_BY_TYPE: Record<VariableType, string[]> = {
	COLOR: ['ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'EFFECT_COLOR'],
	FLOAT: [
		'CORNER_RADIUS',
		'WIDTH_HEIGHT',
		'GAP',
		'OPACITY',
		'STROKE_FLOAT',
		'EFFECT_FLOAT',
		'FONT_SIZE',
		'LINE_HEIGHT',
		'LETTER_SPACING',
		'PARAGRAPH_SPACING',
		'PARAGRAPH_INDENT'
	],
	STRING: ['TEXT_CONTENT', 'FONT_FAMILY', 'FONT_STYLE'],
	BOOLEAN: []
};

export function scopeLabel(scope: string): string {
	const words = scope.toLowerCase().split('_');
	const text = words.join(' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An empty scope list or ALL_SCOPES allows everything; else one of `accepted` must be listed. */
export function allowsScope(variable: Variable, accepted: readonly string[]): boolean {
	if (variable.scopes.length === 0) return true;
	if (variable.scopes.includes('ALL_SCOPES')) return true;
	return variable.scopes.some((scope) => accepted.includes(scope));
}

/** Variables a field of `type` accepting `scopes` may bind. */
export function bindableVariables(
	variables: readonly Variable[],
	type: VariableType,
	scopes: readonly string[]
): Variable[] {
	return variables.filter(
		(variable) => variable.resolvedType === type && allowsScope(variable, scopes)
	);
}

/** Next free `<base> N` style name among `taken` ("Collection 2"). */
export function uniqueName(base: string, taken: readonly string[]): string {
	if (!taken.includes(base)) return base;
	for (let number = 2; ; number += 1) {
		const candidate = `${base} ${number}`;
		if (!taken.includes(candidate)) return candidate;
	}
}
