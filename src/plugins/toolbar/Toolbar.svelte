<script lang="ts">
	import { Tooltip } from '@neoworks-dev/ui';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { TOOLBAR_MENU, type ToolbarMode } from './service.svelte';
	import type { ToolbarSlot } from './slots';

	const ctx = getKernel();

	const slots = $derived(ctx.toolbar.slots());
	const modes = $derived(ctx.toolbar.modes());
	const currentMode = $derived(ctx.toolbar.currentMode());
	const menuItems = $derived(ctx.menus.resolve(TOOLBAR_MENU));
	const accentClass = $derived(
		currentMode?.accent === 'green' ? 'bg-green text-white' : 'bg-blue text-white'
	);
	const activeId = $derived(ctx.tools.activeId());

	function tooltipText(title: string, command: string): string {
		const accelerator = ctx.keymap.lookup(command);
		if (accelerator === undefined) return title;
		return `${title} (${accelerator})`;
	}

	function separatorBefore(position: number): boolean {
		if (position === 0) return false;
		const previous = ctx.toolbar.shown(slots[position - 1]).tool.group;
		return previous !== ctx.toolbar.shown(slots[position]).tool.group;
	}

	function activate(command: string): void {
		void ctx.commands.run(command).catch((error: unknown) => ctx.logger.error(error));
	}

	function anchorOf(event: MouseEvent): { x: number; y: number } {
		const slotElement = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-slot]');
		const rect = (slotElement ?? (event.currentTarget as HTMLElement)).getBoundingClientRect();
		return { x: rect.left, y: rect.top - 6 };
	}

	function openGroup(event: MouseEvent, slot: ToolbarSlot): void {
		if (slot.group === undefined) return;
		ctx.toolbar.openGroupMenu(slot.group, anchorOf(event));
	}

	function setMode(mode: ToolbarMode): void {
		if (mode.id === currentMode?.id) return;
		void ctx.toolbar.switchMode(mode).catch((error: unknown) => ctx.logger.error(error));
	}
</script>

<div
	role="toolbar"
	aria-label="Tools"
	class="bg-elevated border-line flex items-center gap-1.5 rounded-2xl border p-2 shadow-lg"
	data-toolbar
>
	{#each slots as slot, position (slot.id)}
		{@const entry = ctx.toolbar.shown(slot)}
		{@const active = slot.entries.some((member) => member.id === activeId)}
		{#if separatorBefore(position)}
			<div role="separator" aria-orientation="vertical" class="bg-line-faint mx-1 h-6 w-px"></div>
		{/if}
		{#if entry.tool.icon}
			{@const Icon = entry.tool.icon}
			<div class="flex items-center" data-slot={slot.id}>
				<Tooltip text={tooltipText(entry.tool.title, entry.command)} placement="top">
					<button
						type="button"
						aria-label={entry.tool.title}
						aria-pressed={active}
						data-locked={(active && ctx.tools.locked) || undefined}
						class={[
							'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors select-none',
							active ? accentClass : 'text-muted hover:bg-hover hover:text-default',
							active && ctx.tools.locked && 'ring-offset-elevated ring-blue ring-2 ring-offset-2'
						]}
						onclick={() => activate(entry.command)}
						ondblclick={() => ctx.tools.activate(entry.id, { lock: true })}
					>
						<Icon size={20} />
					</button>
				</Tooltip>
				{#if slot.entries.length > 1}
					<button
						type="button"
						aria-label="More {entry.tool.title} tools"
						aria-haspopup="menu"
						data-slot-caret={slot.id}
						class="text-muted hover:bg-hover hover:text-default flex h-10 w-5 items-center justify-center rounded-md"
						onclick={(event) => openGroup(event, slot)}
					>
						<CaretDownIcon size={10} weight="bold" />
					</button>
				{/if}
			</div>
		{/if}
	{/each}

	{#each menuItems as item (item.id)}
		{#if item.icon && item.submenuPath}
			{@const path = item.submenuPath}
			{@const Icon = item.icon}
			<div class="flex items-center" data-slot={`menu:${item.id}`}>
				<button
					type="button"
					aria-label={item.title}
					aria-haspopup="menu"
					class="text-muted hover:bg-hover hover:text-default flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors"
					onclick={(event) => ctx.toolbar.openMenu(path, anchorOf(event))}
				>
					<Icon size={20} />
				</button>
			</div>
		{/if}
	{/each}

	{#if modes.length > 0}
		<div role="separator" aria-orientation="vertical" class="bg-line-faint mx-1 h-6 w-px"></div>
		<div
			role="group"
			aria-label="Mode"
			class="bg-canvas flex items-center gap-0.5 rounded-lg p-0.5"
		>
			{#each modes as mode (mode.id)}
				{@const Icon = mode.icon}
				{@const selected = mode.id === currentMode?.id}
				<Tooltip text={tooltipText(mode.title, mode.command)} placement="top">
					<button
						type="button"
						aria-label={mode.title}
						aria-pressed={selected}
						data-mode={mode.id}
						class={[
							'flex size-9 items-center justify-center rounded-md transition-colors',
							selected && mode.accent === 'green' && 'bg-hover text-green',
							selected && mode.accent !== 'green' && 'bg-hover text-blue',
							!selected && 'text-muted hover:text-default'
						]}
						onclick={() => setMode(mode)}
					>
						<Icon size={20} />
					</button>
				</Tooltip>
			{/each}
		</div>
	{/if}
</div>
