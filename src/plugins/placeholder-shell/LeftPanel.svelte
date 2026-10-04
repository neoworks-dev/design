<script lang="ts">
	import HashIcon from 'phosphor-svelte/lib/HashIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';

	const layers = ['Activities', 'Dashboard', 'Chat', 'Sign In', 'Checkout'];
</script>

<div class="flex h-full flex-col text-sm">
	<div class="border-line-faint flex h-10 shrink-0 items-center gap-1 border-b px-3">
		<span class="bg-raised rounded-md px-2 py-1 text-xs font-medium">File</span>
		<span class="text-dim px-2 py-1 text-xs font-medium">Assets</span>
		<span class="text-muted ml-auto"><MagnifyingGlassIcon size={14} /></span>
	</div>

	<section class="border-line-faint border-b px-3 py-2">
		<div class="flex h-7 items-center justify-between">
			<h2 class="text-xs font-semibold">Pages</h2>
			<span class="text-muted"><PlusIcon size={14} /></span>
		</div>
		<div class="bg-raised mt-1 rounded-md px-2 py-1 text-xs">Page 1</div>
	</section>

	<section class="px-3 py-2">
		<h2 class="flex h-7 items-center text-xs font-semibold">Layers</h2>
		<ul class="mt-1 flex flex-col gap-0.5">
			{#each layers as layer (layer)}
				<li class="text-muted hover:bg-hover flex h-7 items-center gap-2 rounded-md px-2 text-xs">
					<HashIcon size={12} />
					{layer}
				</li>
			{/each}
		</ul>
		<p class="text-faint px-2 pt-3 text-xs">Placeholder: the layers panel replaces this.</p>
	</section>
</div>
