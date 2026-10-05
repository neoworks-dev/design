<script lang="ts">
	import { onMount } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	let host: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();

	// Contributions read the reactive state they draw (`track`); a change redraws.
	$effect(() => {
		for (const contribution of ctx.overlay.contributions()) contribution.track?.();
		ctx.overlay.requestRedraw('state');
	});

	onMount(() => {
		const element = canvas;
		const container = host;
		if (!element || !container) return;
		const detach = ctx.overlay.attachCanvas(element);
		const resize = (): void => {
			const box = container.getBoundingClientRect();
			ctx.overlay.resize(box.width, box.height, window.devicePixelRatio);
		};
		resize();
		const stopWatching = ctx.effect(() => {
			const observer = new ResizeObserver(resize);
			observer.observe(container);
			return () => observer.disconnect();
		}, 'overlay/canvas size');
		return () => {
			stopWatching();
			detach();
		};
	});
</script>

<!-- Non-interactive: pointer events fall through to the canvas input router. -->
<div bind:this={host} class="pointer-events-none absolute inset-0" data-overlay-host>
	<canvas bind:this={canvas} class="block h-full w-full" data-overlay-canvas></canvas>
</div>
