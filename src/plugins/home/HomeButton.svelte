<script lang="ts">
	import HouseIcon from 'phosphor-svelte/lib/HouseIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	// macOS draws its traffic lights over the top-left corner of the window.
	const insetForTrafficLights = ctx.desktop.platform === 'darwin';
</script>

<!-- Sits in front of the tabs and looks like one: filled while the home screen is the current view. -->
<div class="app-no-drag flex shrink-0 items-stretch" class:pl-20={insetForTrafficLights}>
	<button
		type="button"
		aria-label="Home"
		aria-pressed={ctx.home.visible}
		class="inline-flex w-10 items-center justify-center"
		class:bg-canvas={ctx.home.visible}
		class:text-default={ctx.home.visible}
		class:text-muted={!ctx.home.visible}
		class:hover:bg-hover={!ctx.home.visible}
		class:hover:text-default={!ctx.home.visible}
		onclick={() => {
			if (ctx.home.visible) ctx.home.hide();
			else ctx.home.show();
		}}
	>
		<HouseIcon size={16} weight={ctx.home.visible ? 'fill' : 'regular'} />
	</button>
</div>
