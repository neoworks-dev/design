<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';

	const sections = ['Page', 'Variables', 'Styles', 'Export'];
</script>

<div class="flex h-full flex-col text-sm">
	<div class="border-line-faint flex h-10 shrink-0 items-center gap-1 border-b px-3">
		<span class="bg-raised rounded-md px-2 py-1 text-xs font-medium">Design</span>
		<span class="text-dim px-2 py-1 text-xs font-medium">Prototype</span>
		<span class="text-muted ml-auto text-xs">100%</span>
	</div>

	{#each sections as section (section)}
		<section class="border-line-faint flex h-10 items-center justify-between border-b px-3">
			<h2 class="text-muted text-xs font-semibold">{section}</h2>
			<span class="text-muted"><PlusIcon size={14} /></span>
		</section>
	{/each}
	<p class="text-faint px-3 pt-3 text-xs">Placeholder: property sections replace this.</p>
</div>
