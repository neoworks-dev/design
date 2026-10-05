<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import type { RenderedFrame } from '../../lib/prototype/frameRender';
	import type { ScreenChange } from '../../lib/prototype/machine';
	import { devicePreset, type ScaleMode } from '../../lib/prototype/model';
	import type { PrototypeSession } from '../../lib/prototype/session.svelte';
	import { planTransition, type TransitionPlan } from '../../lib/prototype/transitions';
	import FrameView from './FrameView.svelte';

	let {
		session,
		scaleMode = 'fit',
		deviceId = 'none'
	}: {
		session: PrototypeSession;
		scaleMode?: ScaleMode;
		deviceId?: string;
	} = $props();

	const ctx = getKernel();

	const PADDING = 48;
	const MAX_FIT_SCALE = 4;

	let baseFrame = $state.raw<RenderedFrame | null>(null);
	let leavingFrame = $state.raw<RenderedFrame | null>(null);
	let overlayFrames = $state.raw<RenderedFrame[]>([]);
	let leavingOnTop = $state(false);
	let baseView = $state<FrameView>();
	let stage = $state<HTMLElement>();
	let root = $state<HTMLElement>();
	let availableWidth = $state(0);
	let availableHeight = $state(0);
	let handledSerial = 0;
	let queue: Promise<void> = Promise.resolve();

	const device = $derived(devicePreset(deviceId));
	const viewWidth = $derived.by(() => {
		if (device.width > 0) return device.width;
		if (baseFrame === null) return 0;
		return baseFrame.width;
	});
	const viewHeight = $derived.by(() => {
		if (device.height > 0) return device.height;
		if (baseFrame === null) return 0;
		return baseFrame.height;
	});
	const outerWidth = $derived(viewWidth + device.bezel * 2);
	const outerHeight = $derived(viewHeight + device.bezel * 2);
	const scale = $derived.by(() => {
		if (outerWidth === 0 || scaleMode === 'actual') return 1;
		const fitWidth = (availableWidth - PADDING) / outerWidth;
		if (scaleMode === 'fill') return Math.max(0.1, fitWidth);
		const fitHeight = (availableHeight - PADDING) / outerHeight;
		return Math.max(0.1, Math.min(fitWidth, fitHeight, MAX_FIT_SCALE));
	});

	onMount(() => {
		void session.frame(session.startFrame).then((frame) => {
			if (baseFrame === null) baseFrame = frame;
		});
		root?.focus();
	});

	$effect(() => {
		const played = session.lastChange;
		if (played === null || played.serial === handledSerial) return;
		handledSerial = played.serial;
		untrack(() => {
			queue = queue.then(() => present(played.change));
		});
	});

	$effect(() => {
		const request = session.scrollRequest;
		if (request === null) return;
		untrack(() => {
			const offset = ctx.prototypePlayer.offsetInFrame(session.current, request.nodeId);
			baseView?.scrollToOffset(offset.x, offset.y);
		});
	});

	async function present(change: ScreenChange): Promise<void> {
		let incoming: RenderedFrame | null = null;
		if (change.to !== null) incoming = await session.frame(change.to);
		if (change.kind === 'screen') await presentScreen(change, incoming);
		else if (change.kind === 'overlay-open') await presentOverlay(change, incoming);
		else if (change.kind === 'overlay-close') closeOverlay(change.from);
		else swapOverlay(change, incoming);
	}

	function planFor(change: ScreenChange): TransitionPlan | null {
		if (change.transition === undefined) return null;
		return planTransition(change.transition, { width: viewWidth, height: viewHeight });
	}

	function layerElement(name: string): HTMLElement | null {
		if (stage === undefined) return null;
		return stage.querySelector<HTMLElement>(`[data-layer="${name}"]`);
	}

	function animateLayer(
		element: HTMLElement | null,
		keyframes: TransitionPlan['incoming'],
		plan: TransitionPlan
	): Promise<unknown> {
		if (element === null || typeof element.animate !== 'function') return Promise.resolve();
		const animation = element.animate(keyframes, {
			duration: plan.durationMilliseconds,
			easing: plan.easing
		});
		return animation.finished.catch(() => undefined);
	}

	async function presentScreen(
		change: ScreenChange,
		incoming: RenderedFrame | null
	): Promise<void> {
		if (incoming === null) return;
		const plan = planFor(change);
		leavingFrame = null;
		if (plan !== null && change.from !== null) leavingFrame = baseFrame;
		baseFrame = incoming;
		overlayFrames = [];
		if (plan === null) return;
		leavingOnTop = !plan.incomingOnTop;
		await tick();
		await Promise.all([
			animateLayer(layerElement('base'), plan.incoming, plan),
			animateLayer(layerElement('leaving'), plan.outgoing, plan)
		]);
		leavingFrame = null;
	}

	async function presentOverlay(
		change: ScreenChange,
		incoming: RenderedFrame | null
	): Promise<void> {
		if (incoming === null) return;
		overlayFrames = [...overlayFrames, incoming];
		const plan = planFor(change);
		if (plan === null) return;
		await tick();
		await animateLayer(layerElement(`overlay-${incoming.frameId}`), plan.incoming, plan);
	}

	function closeOverlay(frameId: string | null): void {
		overlayFrames = overlayFrames.filter((frame) => frame.frameId !== frameId);
	}

	function swapOverlay(change: ScreenChange, incoming: RenderedFrame | null): void {
		const remaining = overlayFrames.filter((frame) => frame.frameId !== change.from);
		if (incoming === null) overlayFrames = remaining;
		else overlayFrames = [...remaining, incoming];
	}

	function onkeydown(event: KeyboardEvent): void {
		const frames = [baseFrame, ...overlayFrames].filter((frame) => frame !== null);
		for (const frame of frames) {
			for (const spot of frame.hotspots) {
				if (!spot.triggers.includes('ON_KEY_DOWN')) continue;
				if (!session.fire(spot.nodeId, 'ON_KEY_DOWN', event.keyCode)) continue;
				event.preventDefault();
				return;
			}
		}
	}

	function overlayStyle(frame: RenderedFrame): string {
		const left = (viewWidth - frame.width) / 2;
		const top = (viewHeight - frame.height) / 2;
		return `left:${left}px;top:${top}px;width:${frame.width}px;height:${frame.height}px`;
	}
</script>

<!-- Key triggers (ON_KEY_DOWN) listen on the focused player. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	bind:clientWidth={availableWidth}
	bind:clientHeight={availableHeight}
	class="bg-canvas relative flex h-full w-full overflow-auto outline-none"
	tabindex="-1"
	role="application"
	aria-label="Prototype"
	data-player
	{onkeydown}
>
	{#if baseFrame === null}
		<div class="text-faint m-auto text-sm">Nothing to play on this page.</div>
	{:else}
		<div
			class="m-auto shrink-0"
			style:width="{outerWidth * scale}px"
			style:height="{outerHeight * scale}px"
			data-player-device={deviceId}
		>
			<div
				class="origin-top-left"
				style:width="{outerWidth}px"
				style:height="{outerHeight}px"
				style:transform="scale({scale})"
				style:padding="{device.bezel}px"
				style:background={device.bezel > 0 ? '#111114' : 'transparent'}
				style:border-radius="{device.radius + device.bezel}px"
				style:box-sizing="border-box"
			>
				<div
					bind:this={stage}
					class="relative overflow-hidden bg-white"
					style:width="{viewWidth}px"
					style:height="{viewHeight}px"
					style:border-radius="{device.radius}px"
					data-player-stage
				>
					{#if leavingFrame !== null}
						<div
							class="absolute top-0 left-0"
							style:width="{leavingFrame.width}px"
							style:height="{leavingFrame.height}px"
							style:z-index={leavingOnTop ? 2 : 1}
							data-layer="leaving"
						>
							<FrameView frame={leavingFrame} {session} active={false} />
						</div>
					{/if}
					{#key baseFrame.frameId}
						<div
							class="absolute top-0 left-0"
							style:width="{baseFrame.width}px"
							style:height="{baseFrame.height}px"
							style:z-index={leavingOnTop ? 1 : 2}
							data-layer="base"
						>
							<FrameView bind:this={baseView} frame={baseFrame} {session} active={true} />
						</div>
					{/key}
					{#each overlayFrames as overlay (overlay.frameId)}
						<div
							class="absolute"
							style={overlayStyle(overlay)}
							style:z-index="3"
							data-layer="overlay-{overlay.frameId}"
						>
							<FrameView frame={overlay} {session} active={true} />
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
