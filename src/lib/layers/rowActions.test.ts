import { describe, expect, it } from 'vitest';
import { applyChanges, DocumentStore } from '../document';
import { buildDocument, frame, page, rectangle, text } from '../document/fixtures';
import { layersMatching, planIsolateFlag, planToggleFlag } from './rowActions';

// page p: [f [a, b, c], t (text), loose]
function sample(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page(
				'P',
				[
					frame({ id: 'f', name: 'Card' }, [
						rectangle({ id: 'a', name: 'Avatar' }),
						rectangle({ id: 'b', name: 'Background' }),
						rectangle({ id: 'c', name: 'Border' })
					]),
					text({ id: 't', name: 'Title' }),
					rectangle({ id: 'loose', name: 'Loose' })
				],
				{ id: 'p' }
			)
		])
	);
}

function flag(store: DocumentStore, id: string, name: 'visible' | 'locked'): unknown {
	return Reflect.get(store.requireNode(id), name);
}

function flags(store: DocumentStore, name: 'visible' | 'locked'): unknown[] {
	return ['a', 'b', 'c'].map((id) => flag(store, id, name));
}

function sorted(ids: Set<string> | null): string[] {
	return [...(ids ?? [])].sort();
}

describe('planToggleFlag', () => {
	it('flips one layer', () => {
		const store = sample();
		applyChanges(store, planToggleFlag(store, 'a', 'visible'));
		expect(flags(store, 'visible')).toEqual([false, true, true]);
		applyChanges(store, planToggleFlag(store, 'a', 'locked'));
		expect(flag(store, 'a', 'locked')).toBe(true);
	});
});

describe('planIsolateFlag', () => {
	it('Alt+eye hides the siblings, and again shows them', () => {
		const store = sample();
		applyChanges(store, planIsolateFlag(store, 'b', 'visible'));
		expect(flags(store, 'visible')).toEqual([false, true, false]);
		applyChanges(store, planIsolateFlag(store, 'b', 'visible'));
		expect(flags(store, 'visible')).toEqual([true, true, true]);
	});

	it('Alt+lock locks the siblings, and again unlocks them', () => {
		const store = sample();
		applyChanges(store, planIsolateFlag(store, 'b', 'locked'));
		expect(flags(store, 'locked')).toEqual([true, false, true]);
		applyChanges(store, planIsolateFlag(store, 'b', 'locked'));
		expect(flags(store, 'locked')).toEqual([false, false, false]);
	});
});

describe('layersMatching', () => {
	it('is null without a filter', () => {
		expect(layersMatching(sample(), 'p', { query: '  ', types: [] })).toBeNull();
	});

	it('lists name matches together with their ancestors', () => {
		expect(sorted(layersMatching(sample(), 'p', { query: 'bor', types: [] }))).toEqual(['c', 'f']);
	});

	it('filters by type chips, alone or with a query', () => {
		const store = sample();
		expect(sorted(layersMatching(store, 'p', { query: '', types: ['text'] }))).toEqual(['t']);
		expect(sorted(layersMatching(store, 'p', { query: '', types: ['frame'] }))).toEqual(['f']);
		const shapes = layersMatching(store, 'p', { query: 'ba', types: ['shape'] });
		expect(sorted(shapes)).toEqual(['b', 'f']);
	});
});
