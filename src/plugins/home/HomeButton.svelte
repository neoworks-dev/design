<script lang="ts">
	import HouseIcon from 'phosphor-svelte/lib/HouseIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	// macOS draws its traffic lights over the top-left corner of the window.
	const insetForTrafficLights = ctx.desktop.platform === 'darwin';
</script>

<div class="app-no-drag flex shrink-0 items-center px-1.5" class:pl-20={insetForTrafficLights}>
	<button
		type="button"
		aria-label="Home"
		aria-pressed={ctx.home.visible}
		class="text-muted hover:bg-hover hover:text-default inline-flex size-7 items-center justify-center rounded"
		class:bg-raised={ctx.home.visible}
		onclick={() => {
			if (ctx.home.visible) ctx.home.hide();
			else ctx.home.show();
		}}
	>
		<HouseIcon size={14} weight="bold" />
	</button>
</div>
