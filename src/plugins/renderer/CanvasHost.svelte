<script lang="ts">
	import { onMount } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();

	let host: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();

	function currentRatio(): number {
		return window.devicePixelRatio;
	}

	function measure(element: HTMLElement): { width: number; height: number } {
		const box = element.getBoundingClientRect();
		return { width: box.width, height: box.height };
	}

	onMount(() => {
		const element = canvas;
		const container = host;
		if (!element || !container) return;
		const initial = measure(container);
		element.width = Math.max(1, Math.round(initial.width * currentRatio()));
		element.height = Math.max(1, Math.round(initial.height * currentRatio()));
		const detach = ctx.renderer.attachCanvas(element);
		const resize = (): void => {
			const box = measure(container);
			ctx.renderer.resize(box.width, box.height, currentRatio());
		};
		resize();
		// The canvas fills its host. Its pixel size is box size times the device pixel ratio, so the
		// surface is rebuilt when either changes (window resize, another display, browser zoom).
		const stopWatching = ctx.effect(() => {
			const observer = new ResizeObserver(resize);
			observer.observe(container);
			let ratioQuery: MediaQueryList | undefined;
			const onRatioChange = (): void => {
				resize();
				listenForRatio();
			};
			const listenForRatio = (): void => {
				ratioQuery?.removeEventListener('change', onRatioChange);
				ratioQuery = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
				ratioQuery.addEventListener('change', onRatioChange);
			};
			listenForRatio();
			return () => {
				observer.disconnect();
				ratioQuery?.removeEventListener('change', onRatioChange);
			};
		}, 'renderer/canvas size');
		return () => {
			stopWatching();
			detach();
		};
	});
</script>

<!-- The canvas input router (separate issue) takes over pointer events; until then the context
     menu request is forwarded as a kernel event. -->
<div bind:this={host} class="relative min-w-0 flex-1 overflow-hidden" data-canvas-host>
	<canvas
		bind:this={canvas}
		class="absolute inset-0 block h-full w-full"
		data-renderer-canvas
		oncontextmenu={(event) => ctx.emit('canvas/contextmenu', event)}
	></canvas>
</div>
