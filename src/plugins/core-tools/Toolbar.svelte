<script lang="ts">
	import { Tooltip } from '@neoworks-dev/ui';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();

	const entries = $derived(ctx.tools.toolbarTools());
	const activeId = $derived(ctx.tools.activeId());

	function tooltipText(title: string, shortcut: string | undefined): string {
		if (shortcut === undefined) return title;
		return `${title} (${shortcut})`;
	}

	function activate(command: string): void {
		void ctx.commands.run(command).catch((error: unknown) => ctx.logger.error(error));
	}
</script>

<div
	role="toolbar"
	aria-label="Tools"
	class="bg-elevated border-line flex items-center gap-1 rounded-xl border p-1.5 shadow-lg"
>
	{#each entries as entry, position (entry.id)}
		{#if position > 0 && entries[position - 1].tool.group !== entry.tool.group}
			<div role="separator" aria-orientation="vertical" class="bg-line-faint mx-0.5 h-5 w-px"></div>
		{/if}
		{#if entry.tool.icon}
			<Tooltip text={tooltipText(entry.tool.title, entry.tool.shortcut)} placement="top">
				<IconButton
					icon={entry.tool.icon}
					label={entry.tool.title}
					variant={activeId === entry.id ? 'primary' : 'ghost'}
					pressed={activeId === entry.id}
					locked={activeId === entry.id && ctx.tools.locked}
					onclick={() => activate(entry.command)}
					ondblclick={() => ctx.tools.activate(entry.id, { lock: true })}
				/>
			</Tooltip>
		{/if}
	{/each}
</div>
