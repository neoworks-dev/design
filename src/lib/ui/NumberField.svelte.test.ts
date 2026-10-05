import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NumberField from './NumberField.svelte';
import type { NumberGesture } from './numberField';

interface Change {
	value: number;
	gesture: NumberGesture;
}

let target: HTMLElement | undefined;
let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (component) await unmount(component);
	target?.remove();
	component = undefined;
	target = undefined;
});

function render(props: { value: number | null; mixed?: boolean; unit?: string }): Change[] {
	const changes: Change[] = [];
	target = document.createElement('div');
	document.body.append(target);
	component = mount(NumberField, {
		target,
		props: {
			label: 'X',
			name: 'X position',
			min: -100,
			max: 100,
			...props,
			onchange: (value: number, gesture: NumberGesture) => changes.push({ value, gesture })
		}
	});
	flushSync();
	return changes;
}

function input(): HTMLInputElement {
	const found = target?.querySelector('input');
	if (!found) throw new Error('no input');
	return found;
}

function type(text: string): void {
	input().focus();
	input().value = text;
	input().dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function press(key: string, init: KeyboardEventInit = {}): void {
	input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	flushSync();
}

describe('NumberField', () => {
	it('commits a typed number or expression on Enter', () => {
		const changes = render({ value: 10 });
		type('10+5');
		press('Enter');
		expect(changes).toEqual([{ value: 15, gesture: 'commit' }]);
	});

	it('commits on blur and clamps to the range', () => {
		const changes = render({ value: 10 });
		type('500');
		input().dispatchEvent(new FocusEvent('blur'));
		expect(changes).toEqual([{ value: 100, gesture: 'commit' }]);
	});

	it('reverts on Escape and ignores invalid text', () => {
		const changes = render({ value: 10 });
		type('99');
		press('Escape');
		expect(input().value).toBe('10');
		type('abc');
		press('Enter');
		expect(input().value).toBe('10');
		expect(changes).toEqual([]);
	});

	it('steps with Up and Down, ten times as far with Shift', () => {
		const changes = render({ value: 10 });
		press('ArrowUp');
		press('ArrowDown', { shiftKey: true });
		expect(changes).toEqual([
			{ value: 11, gesture: 'step' },
			{ value: 0, gesture: 'step' }
		]);
	});

	it('shows Mixed with an empty input and does not commit unchanged text', () => {
		const changes = render({ value: null, mixed: true });
		expect(input().value).toBe('');
		expect(input().placeholder).toBe('Mixed');
		type('');
		press('Enter');
		expect(changes).toEqual([]);
		type('7');
		press('Enter');
		expect(changes).toEqual([{ value: 7, gesture: 'commit' }]);
	});

	it('scrubs when the label is dragged', () => {
		const changes = render({ value: 10 });
		const label = target?.querySelector('[data-number-label]');
		if (!label) throw new Error('no label');
		label.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
		label.dispatchEvent(new MouseEvent('pointermove', { clientX: 105, bubbles: true }));
		label.dispatchEvent(new MouseEvent('pointerup', { clientX: 105, bubbles: true }));
		expect(changes).toEqual([{ value: 15, gesture: 'scrub' }]);
	});

	it('shows the value the parent stored, not the text that was typed', () => {
		const props = $state<{ value: number | null }>({ value: 10 });
		target = document.createElement('div');
		document.body.append(target);
		component = mount(NumberField, {
			target,
			props: {
				label: 'X',
				name: 'X position',
				get value() {
					return props.value;
				},
				onchange: (value: number) => {
					props.value = value + 1;
				}
			}
		});
		flushSync();
		type('20');
		press('Enter');
		flushSync();
		expect(input().value).toBe('21');
	});
});
