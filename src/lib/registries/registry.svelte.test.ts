import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { Registry, type RegistryEntry } from './registry.svelte';

interface Item extends RegistryEntry {
	label: string;
}

class Filtered extends Registry<Item> {
	protected override isActive(entry: Item): boolean {
		return entry.label !== 'hidden';
	}
}

describe('Registry', () => {
	it('registers and reads entries', () => {
		const registry = new Registry<Item>();
		registry.register({ id: 'a', label: 'first' });
		expect(registry.get('a')?.label).toBe('first');
		expect(registry.has('a')).toBe(true);
		expect(registry.has('b')).toBe(false);
		expect(registry.list().map((item) => item.id)).toEqual(['a']);
	});

	it('replaces by id and keeps the position', () => {
		const registry = new Registry<Item>();
		registry.register({ id: 'a', label: 'one' });
		registry.register({ id: 'b', label: 'two' });
		registry.register({ id: 'a', label: 'three' });
		expect(registry.list().map((item) => item.label)).toEqual(['three', 'two']);
	});

	it('disposes by identity: a stale disposer leaves the newer entry in place', () => {
		const registry = new Registry<Item>();
		const disposeFirst = registry.register({ id: 'a', label: 'first' });
		const disposeSecond = registry.register({ id: 'a', label: 'second' });
		disposeFirst();
		expect(registry.get('a')?.label).toBe('second');
		disposeSecond();
		expect(registry.has('a')).toBe(false);
	});

	it('treats a double dispose as a no-op', () => {
		const registry = new Registry<Item>();
		const dispose = registry.register({ id: 'a', label: 'first' });
		registry.register({ id: 'b', label: 'second' });
		dispose();
		dispose();
		expect(registry.list().map((item) => item.id)).toEqual(['b']);
	});

	it('does not let a disposed handle remove a re-registered id', () => {
		const registry = new Registry<Item>();
		const dispose = registry.register({ id: 'a', label: 'first' });
		dispose();
		registry.register({ id: 'a', label: 'again' });
		dispose();
		expect(registry.get('a')?.label).toBe('again');
	});

	it('orders by order then registration', () => {
		const registry = new Registry<Item>();
		registry.register({ id: 'late', label: '', order: 10 });
		registry.register({ id: 'first', label: '' });
		registry.register({ id: 'second', label: '' });
		registry.register({ id: 'early', label: '', order: -5 });
		expect(registry.list().map((item) => item.id)).toEqual(['early', 'first', 'second', 'late']);
	});

	it('hides entries through the isActive hook but lists them in listAll', () => {
		const registry = new Filtered();
		registry.register({ id: 'a', label: 'hidden' });
		registry.register({ id: 'b', label: 'shown' });
		expect(registry.list().map((item) => item.id)).toEqual(['b']);
		expect(registry.listAll().map((item) => item.id)).toEqual(['a', 'b']);
	});

	it('updates reactive readers on register and dispose', () => {
		const registry = new Registry<Item>();
		const seen: string[][] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(registry.list().map((item) => item.id));
			});
		});
		flushSync();
		const dispose = registry.register({ id: 'a', label: '' });
		flushSync();
		dispose();
		flushSync();
		stop();
		expect(seen).toEqual([[], ['a'], []]);
	});
});
