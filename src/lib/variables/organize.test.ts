import { describe, expect, it } from 'vitest';
import type { Variable } from '../document';
import {
	allowsScope,
	bindableVariables,
	groupPathOf,
	groupVariables,
	leafNameOf,
	uniqueName
} from './organize';

function variable(
	name: string,
	scopes: string[] = [],
	type: Variable['resolvedType'] = 'FLOAT'
): Variable {
	return {
		id: name,
		name,
		collectionId: 'c',
		resolvedType: type,
		valuesByMode: {},
		scopes,
		codeSyntax: {},
		description: ''
	};
}

describe('variable names', () => {
	it('split at the last slash', () => {
		expect(groupPathOf('Colors/Brand/Primary')).toBe('Colors/Brand');
		expect(leafNameOf('Colors/Brand/Primary')).toBe('Primary');
		expect(groupPathOf('Solo')).toBe('');
		expect(leafNameOf('Solo')).toBe('Solo');
	});

	it('group with the ungrouped ones first', () => {
		const groups = groupVariables([variable('A/x'), variable('top'), variable('A/y')]);
		expect(groups.map((group) => [group.path, group.variables.map((entry) => entry.name)])).toEqual(
			[
				['', ['top']],
				['A', ['A/x', 'A/y']]
			]
		);
	});
});

describe('scopes', () => {
	it('an empty list or ALL_SCOPES allows everything, otherwise one scope must match', () => {
		expect(allowsScope(variable('a'), ['GAP'])).toBe(true);
		expect(allowsScope(variable('a', ['ALL_SCOPES']), ['GAP'])).toBe(true);
		expect(allowsScope(variable('a', ['GAP']), ['GAP', 'WIDTH_HEIGHT'])).toBe(true);
		expect(allowsScope(variable('a', ['OPACITY']), ['GAP'])).toBe(false);
	});

	it('bindable variables match type and scope', () => {
		const all = [variable('gap', ['GAP']), variable('op', ['OPACITY']), variable('c', [], 'COLOR')];
		expect(bindableVariables(all, 'FLOAT', ['GAP']).map((entry) => entry.name)).toEqual(['gap']);
	});
});

describe('uniqueName', () => {
	it('numbers a name that is taken', () => {
		expect(uniqueName('Collection', [])).toBe('Collection');
		expect(uniqueName('Collection', ['Collection', 'Collection 2'])).toBe('Collection 3');
	});
});
