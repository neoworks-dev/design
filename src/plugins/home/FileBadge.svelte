<script lang="ts">
	import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';

	let { size = 'md' }: { size?: 'sm' | 'md' } = $props();
</script>

<!-- The design-file mark, like the tinted file-type square in front of Figma's file names. -->
<span
	class="bg-blue-soft text-blue inline-flex shrink-0 items-center justify-center rounded"
	class:size-6={size === 'md'}
	class:size-5={size === 'sm'}
	aria-hidden="true"
>
	<PenNibIcon size={size === 'md' ? 14 : 12} weight="fill" />
</span>
