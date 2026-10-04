<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import type { ResolvedMenuItem } from '../../lib/registries/menus.svelte';
	import MenuList from './MenuList.svelte';
	import { placeWithinViewport } from './placement';

	let {
		items,
		depth = 0,
		focusFirst = false,
		onactivate,
		onclose,
		onleave
	}: {
		items: ResolvedMenuItem[];
		depth?: number;
		/** Focus the first enabled item when the list appears (keyboard-opened submenus). */
		focusFirst?: boolean;
		onactivate: (item: ResolvedMenuItem) => void;
		onclose: () => void;
		/** A submenu asks its parent to close it (ArrowLeft). */
		onleave?: () => void;
	} = $props();

	let list: HTMLElement | undefined = $state();
	let openSubmenuId: string | undefined = $state();
	let submenuFocusFirst = $state(false);

	function enabledButtons(): HTMLButtonElement[] {
		if (!list) return [];
		const buttons = [...list.querySelectorAll<HTMLButtonElement>(':scope > li > [data-menu-item]')];
		return buttons.filter((button) => !button.disabled);
	}

	function moveFocus(step: number): void {
		const buttons = enabledButtons();
		if (buttons.length === 0) return;
		const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (current < 0 && step > 0) {
			buttons[0].focus();
			return;
		}
		if (current < 0) {
			buttons[buttons.length - 1].focus();
			return;
		}
		buttons[(current + step + buttons.length) % buttons.length].focus();
	}

	function focusEdge(last: boolean): void {
		const buttons = enabledButtons();
		if (buttons.length === 0) return;
		if (last) buttons[buttons.length - 1].focus();
		else buttons[0].focus();
	}

	function itemFor(target: EventTarget | null): ResolvedMenuItem | undefined {
		if (!(target instanceof HTMLElement)) return undefined;
		const id = target.closest<HTMLElement>('[data-menu-item]')?.dataset.menuItem;
		return items.find((item) => item.id === id);
	}

	function openSubmenu(item: ResolvedMenuItem, viaKeyboard: boolean): void {
		if (!item.submenu || !item.enabled) return;
		submenuFocusFirst = viaKeyboard;
		openSubmenuId = item.id;
	}

	function closeSubmenu(): void {
		const id = openSubmenuId;
		openSubmenuId = undefined;
		if (id === undefined || !list) return;
		list.querySelector<HTMLButtonElement>(`:scope > li > [data-menu-item="${id}"]`)?.focus();
	}

	function onkeydown(event: KeyboardEvent): void {
		// The menu owns the keyboard while open: tool and app shortcuts must not fire through it.
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveFocus(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveFocus(-1);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusEdge(false);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusEdge(true);
		} else if (event.key === 'ArrowRight') {
			const item = itemFor(event.target);
			if (item?.submenu) {
				event.preventDefault();
				openSubmenu(item, true);
			}
		} else if (event.key === 'ArrowLeft' && depth > 0) {
			event.preventDefault();
			onleave?.();
		}
	}

	function onpointerenter(item: ResolvedMenuItem): void {
		if (item.submenu) {
			openSubmenu(item, false);
			return;
		}
		openSubmenuId = undefined;
	}

	function activate(item: ResolvedMenuItem): void {
		if (!item.enabled) return;
		if (item.submenu) {
			openSubmenu(item, true);
			return;
		}
		onactivate(item);
	}

	$effect(() => {
		if (focusFirst) focusEdge(false);
		else if (depth === 0) list?.focus();
	});
</script>

<ul
	bind:this={list}
	role="menu"
	tabindex="-1"
	class="bg-elevated border-line text-default pointer-events-auto min-w-48 rounded-lg border p-1 text-xs shadow-lg outline-none"
	{onkeydown}
>
	{#each items as item (item.id)}
		{#if item.separatorBefore}
			<li role="separator" class="bg-line-faint mx-1 my-1 h-px"></li>
		{/if}
		<li role="none" class="relative">
			<button
				type="button"
				role={item.checked ? 'menuitemcheckbox' : 'menuitem'}
				aria-checked={item.checked ? true : undefined}
				aria-haspopup={item.submenu ? 'menu' : undefined}
				aria-expanded={item.submenu ? openSubmenuId === item.id : undefined}
				aria-disabled={item.enabled ? undefined : true}
				disabled={!item.enabled}
				data-menu-item={item.id}
				class="hover:bg-hover focus:bg-hover flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none disabled:cursor-default disabled:opacity-40"
				onclick={() => activate(item)}
				onpointerenter={() => onpointerenter(item)}
			>
				<span class="flex size-3.5 shrink-0 items-center justify-center">
					{#if item.checked}
						<CheckIcon size={12} weight="bold" />
					{/if}
				</span>
				<span class="min-w-0 flex-1 truncate">{item.title}</span>
				{#if item.accelerator}
					<span class="text-faint shrink-0 pl-4" data-menu-accelerator>{item.accelerator}</span>
				{/if}
				{#if item.submenu}
					<CaretRightIcon size={12} class="text-muted shrink-0" />
				{/if}
			</button>
			{#if item.submenu && openSubmenuId === item.id}
				<div use:placeWithinViewport={'submenu'} class="absolute top-0 left-full pl-0.5">
					<MenuList
						items={item.submenu}
						depth={depth + 1}
						focusFirst={submenuFocusFirst}
						{onactivate}
						{onclose}
						onleave={closeSubmenu}
					/>
				</div>
			{/if}
		</li>
	{/each}
</ul>
