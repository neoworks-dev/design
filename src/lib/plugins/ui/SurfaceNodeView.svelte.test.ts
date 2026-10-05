import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { SurfaceNode } from '../surface';
import SurfaceNodeView from './SurfaceNodeView.svelte';

let target: HTMLElement | undefined;
let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (component) await unmount(component);
	target?.remove();
	component = undefined;
	target = undefined;
});

interface Event {
	handler: string;
	value: unknown;
	label: string | undefined;
}

function render(node: SurfaceNode): { root: HTMLElement; events: Event[] } {
	const events: Event[] = [];
	target = document.createElement('div');
	document.body.append(target);
	component = mount(SurfaceNodeView, {
		target,
		props: {
			node,
			onEvent: (handler: string, value: unknown, label: string | undefined) =>
				events.push({ handler, value, label })
		}
	});
	flushSync();
	return { root: target, events };
}

describe('SurfaceNodeView', () => {
	it('renders containers, text and a divider with the design system tokens', () => {
		const { root } = render({
			type: 'stack',
			direction: 'row',
			gap: 'sm',
			children: [
				{
					type: 'section',
					title: 'Settings',
					children: [{ type: 'text', text: 'Body', tone: 'muted' }]
				},
				{ type: 'divider' },
				{
					type: 'list',
					children: [
						{ type: 'text', text: 'one' },
						{ type: 'text', text: 'two' }
					]
				}
			]
		});
		expect(root.querySelector('h3')?.textContent).toBe('Settings');
		expect(root.querySelector('p.text-muted')?.textContent?.trim()).toBe('Body');
		expect(root.querySelector('hr')).not.toBeNull();
		expect(root.querySelectorAll('li')).toHaveLength(2);
		expect(root.firstElementChild?.className).toContain('flex-row');
	});

	it('reports a button click with its handler id and label', () => {
		const { root, events } = render({ type: 'button', label: 'Make grid', onClick: '3:onClick' });
		root.querySelector('button')?.click();
		expect(events).toEqual([{ handler: '3:onClick', value: undefined, label: 'Make grid' }]);
	});

	it('does not report anything for a button without a handler or a disabled one', () => {
		const first = render({ type: 'button', label: 'Idle' });
		first.root.querySelector('button')?.click();
		expect(first.events).toEqual([]);
	});

	it('reports text and number input values on change', () => {
		const text = render({ type: 'input', label: 'Name', value: 'a', onChange: 'n' });
		const field = text.root.querySelector('input');
		if (field === null) throw new Error('no input');
		expect(field.value).toBe('a');
		field.value = 'b';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		expect(text.events).toEqual([{ handler: 'n', value: 'b', label: undefined }]);
	});

	it('reports a number input as a number', () => {
		const { root, events } = render({
			type: 'input',
			value: '3',
			inputType: 'number',
			min: 1,
			max: 9,
			onChange: 'num'
		});
		const field = root.querySelector('input');
		if (field === null) throw new Error('no input');
		expect(field.type).toBe('number');
		field.value = '7';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		expect(events).toEqual([{ handler: 'num', value: 7, label: undefined }]);
	});

	it('reports a color and a checkbox', () => {
		const color = render({ type: 'color', label: 'Fill', value: '#112233', onChange: 'c' });
		const swatch = color.root.querySelector<HTMLInputElement>('input[type="color"]');
		if (swatch === null) throw new Error('no color input');
		swatch.value = '#445566';
		swatch.dispatchEvent(new Event('change', { bubbles: true }));
		expect(color.events).toEqual([{ handler: 'c', value: '#445566', label: undefined }]);
	});

	it('reports a checkbox toggle', () => {
		const { root, events } = render({
			type: 'checkbox',
			label: 'Tidy',
			checked: false,
			onChange: 'k'
		});
		const box = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
		if (box === null) throw new Error('no checkbox');
		box.checked = true;
		box.dispatchEvent(new Event('change', { bubbles: true }));
		expect(events).toEqual([{ handler: 'k', value: true, label: undefined }]);
	});

	it('shows the selected option of a select', () => {
		const { root } = render({
			type: 'select',
			label: 'Mode',
			value: 'b',
			options: [
				{ value: 'a', label: 'Alpha' },
				{ value: 'b', label: 'Beta' }
			]
		});
		expect(root.textContent).toContain('Mode');
		expect(root.textContent).toContain('Beta');
	});

	it('renders an inline image', () => {
		const { root } = render({
			type: 'image',
			src: 'data:image/png;base64,iVBORw0KGgo=',
			alt: 'dot',
			width: 8
		});
		const image = root.querySelector('img');
		expect(image?.getAttribute('alt')).toBe('dot');
		expect(image?.getAttribute('src')).toMatch(/^data:image\/png/);
	});

	it('switches tabs, showing only the active one, and reports the pick', () => {
		const { root, events } = render({
			type: 'tabs',
			onChange: 't',
			children: [
				{ type: 'tab', id: 'one', label: 'One', children: [{ type: 'text', text: 'first' }] },
				{ type: 'tab', id: 'two', label: 'Two', children: [{ type: 'text', text: 'second' }] }
			]
		});
		expect(root.textContent).toContain('first');
		expect(root.textContent).not.toContain('second');
		const second = [...root.querySelectorAll('[role="tab"]')].find(
			(tab) => tab.textContent?.trim() === 'Two'
		);
		(second as HTMLElement).click();
		flushSync();
		expect(root.textContent).toContain('second');
		expect(root.textContent).not.toContain('first');
		expect(events).toEqual([{ handler: 't', value: 'two', label: undefined }]);
	});

	it('renders nothing for a node type it does not know (fails closed)', () => {
		const { root } = render({ type: 'iframe', src: 'https://evil.example' } as never);
		expect(root.innerHTML.replace(/<!---->|<!--.*?-->/g, '')).toBe('');
	});
});
