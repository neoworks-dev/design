<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
</script>

<button
	type="button"
	aria-label="Add page"
	title="Add page"
	class="text-muted hover:bg-hover hover:text-default flex size-7 items-center justify-center rounded-md"
	onclick={() => ctx.pagesPanel.add()}
>
	<PlusIcon size={16} />
</button>
