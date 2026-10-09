<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	const title = $derived.by(() => {
		const value = ctx.contextKeys.get('document.title');
		if (typeof value === 'string' && value.length > 0) return value;
		return 'Untitled';
	});
	const renamable = $derived(ctx.contextKeys.get('document.renamable') === true);
</script>

<header
	class="border-line-faint flex shrink-0 items-start gap-2 border-b pt-3 pr-3 pb-3 pl-4"
	data-file-header
>
	<div class="min-w-0 flex-1">
		{#if renamable}
			<button
				type="button"
				title="Rename file"
				aria-label="Rename file"
				class="text-default flex max-w-full items-center gap-1.5 text-left text-base font-semibold"
				onclick={() => void ctx.commands.run('file.rename')}
			>
				<span class="truncate" data-file-title>{title}</span>
				<CaretDownIcon size={12} class="text-muted shrink-0" />
			</button>
		{:else}
			<span class="text-default block truncate text-base font-semibold" data-file-title
				>{title}</span
			>
		{/if}
	</div>
	<button
		type="button"
		title="Hide sidebar"
		aria-label="Hide sidebar"
		class="text-muted hover:bg-hover hover:text-default flex size-7 shrink-0 items-center justify-center rounded-md"
		onclick={() => void ctx.commands.run('workbench-layout.toggle-left-sidebar')}
	>
		<SidebarSimpleIcon size={16} />
	</button>
</header>
