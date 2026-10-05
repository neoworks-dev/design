// Test harness for the design panel and its section plugins: the real selection, document,
// history and command services, rendered through the sidebar host.

import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { editingProviders } from './editingFixture';
import HostRoot from '../../kernel/fixtures/HostRoot.svelte';
import { mountPlugin, type MountedPlugin } from '../../kernel/testing';
import align from '../../../plugins/align';
import coreInspectors from '../../../plugins/core-inspectors';
import corePanels from '../../../plugins/core-panels';
import mask from '../../../plugins/mask';
import nodeCommands from '../../../plugins/node-commands';
import styles from '../../../plugins/styles';
import variablesCore from '../../../plugins/variables-core';

const storage = { getItem: (): null => null, setItem: (): void => {} };

const fakeViewport = {
	name: 'viewport',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('viewport', {
			zoom: 1,
			zoomTo: (): void => {},
			zoomToFit: (): boolean => true,
			zoomToSelection: (): boolean => true
		})
} as Plugin;

/**
 * Everything a panel plugin needs around it. Page `p` holds frame `f` (at 100,100, 400x400) with
 * 10x10 boxes `a` (0,0), `b` (20,20) and `c` (40,40), plus a top level box `loose`.
 */
export function panelProviders(): Plugin[] {
	const panels = { ...corePanels, apply: (ctx: never) => corePanels.apply(ctx, { storage }) };
	return [
		...editingProviders(),
		variablesCore,
		styles,
		nodeCommands,
		align,
		mask,
		fakeViewport,
		panels,
		coreInspectors
	];
}

export class PanelHarness {
	private constructor(
		readonly ctx: Context,
		private readonly mounted: MountedPlugin,
		private readonly target: HTMLElement,
		private readonly host: ReturnType<typeof mount>
	) {}

	/** Mount `plugin` with the panel providers plus `others`, and render the right sidebar. */
	static async create(plugin: Plugin, others: Plugin[] = []): Promise<PanelHarness> {
		const mounted = await mountPlugin(plugin, { providers: [...panelProviders(), ...others] });
		const target = document.createElement('div');
		document.body.append(target);
		const host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'right' } });
		flushSync();
		return new PanelHarness(mounted.ctx, mounted, target, host);
	}

	async dispose(): Promise<void> {
		await unmount(this.host);
		this.target.remove();
		await this.mounted.cleanup();
	}

	undo(): boolean {
		const undone = this.ctx.history.undo();
		flushSync();
		return undone;
	}

	click(selector: string): void {
		const element = this.query<HTMLElement>(selector);
		if (!element) throw new Error(`nothing matches ${selector}`);
		element.click();
		flushSync();
	}

	/** Change node properties outside the panel, as setup for a test. */
	setProps(id: string, props: Record<string, unknown>): void {
		this.ctx.document.apply(this.ctx.document.setProps(id, props), {
			origin: 'user',
			label: 'test setup'
		});
		flushSync();
	}

	select(ids: string[]): void {
		this.ctx.selection.select(ids);
		flushSync();
	}

	sectionIds(): string[] {
		const sections = [...this.target.querySelectorAll('[data-panel-section]')];
		return sections.map((section) => section.getAttribute('data-panel-section') ?? '');
	}

	query<Element extends HTMLElement>(selector: string): Element | null {
		return this.target.querySelector<Element>(selector);
	}

	field(name: string): HTMLInputElement {
		const found = this.query<HTMLInputElement>(`input[aria-label="${name}"]`);
		if (!found) throw new Error(`no field ${name}`);
		return found;
	}

	/** Type into a number field and press Enter. */
	enter(name: string, text: string): void {
		const input = this.field(name);
		input.focus();
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
	}

	press(name: string, key: string): void {
		this.field(name).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		flushSync();
	}

	translationX(id: string): number {
		const node = this.ctx.document.require(id);
		if (!('transform' in node)) throw new Error(`${id} has no transform`);
		return node.transform[0][2];
	}
}
