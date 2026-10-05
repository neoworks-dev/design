<script lang="ts">
	import { Tooltip } from '@neoworks-dev/ui';
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import { TOOLBAR_MENU } from './service.svelte';
	import type { ToolbarSlot } from './slots';

	const ctx = getKernel();

	const mode = $derived(ctx.contextKeys.get('mode') === 'dev' ? 'dev' : 'design');
	const allSlots = $derived(ctx.toolbar.slots());
	// Dev Mode inspects: only the move group stays.
	const slots = $derived(
		allSlots.filter((slot) => mode === 'design' || ctx.toolbar.shown(slot).tool.group === 'move')
	);
	const menuItems = $derived(ctx.menus.resolve(TOOLBAR_MENU).filter(() => mode === 'design'));
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

	function setMode(value: string): void {
		if (value === mode) return;
		activate('panels.toggle-dev-mode');
	}
</script>

<div
	role="toolbar"
	aria-label="Tools"
	class="bg-elevated border-line flex items-center gap-1 rounded-xl border p-1.5 shadow-lg"
	data-toolbar
>
	{#each slots as slot, position (slot.id)}
		{@const entry = ctx.toolbar.shown(slot)}
		{@const active = slot.entries.some((member) => member.id === activeId)}
		{#if separatorBefore(position)}
			<div role="separator" aria-orientation="vertical" class="bg-line-faint mx-0.5 h-5 w-px"></div>
		{/if}
		{#if entry.tool.icon}
			<div class="flex items-center" data-slot={slot.id}>
				<Tooltip text={tooltipText(entry.tool.title, entry.command)} placement="top">
					<IconButton
						icon={entry.tool.icon}
						label={entry.tool.title}
						variant={active ? 'primary' : 'ghost'}
						pressed={active}
						locked={active && ctx.tools.locked}
						onclick={() => activate(entry.command)}
						ondblclick={() => ctx.tools.activate(entry.id, { lock: true })}
					/>
				</Tooltip>
				{#if slot.entries.length > 1}
					<button
						type="button"
						aria-label="More {entry.tool.title} tools"
						aria-haspopup="menu"
						data-slot-caret={slot.id}
						class="text-muted hover:bg-hover hover:text-default -ml-1 flex h-9 w-4 items-center justify-center rounded-full"
						onclick={(event) => openGroup(event, slot)}
					>
						<CaretUpIcon size={8} weight="bold" />
					</button>
				{/if}
			</div>
		{/if}
	{/each}

	{#each menuItems as item (item.id)}
		{#if item.icon && item.submenuPath}
			{@const path = item.submenuPath}
			<div class="flex items-center" data-slot={`menu:${item.id}`}>
				<IconButton
					icon={item.icon}
					label={item.title}
					onclick={(event) => ctx.toolbar.openMenu(path, anchorOf(event))}
				/>
			</div>
		{/if}
	{/each}

	<div role="separator" aria-orientation="vertical" class="bg-line-faint mx-0.5 h-5 w-px"></div>
	<ToggleGroup
		name="Mode"
		value={mode}
		options={[
			{ value: 'design', label: 'Design' },
			{ value: 'dev', label: 'Dev' }
		]}
		onchange={setMode}
	/>
</div>
