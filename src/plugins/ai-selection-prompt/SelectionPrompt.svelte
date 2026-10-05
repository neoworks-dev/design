<script lang="ts">
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import { tick } from 'svelte';
	import {
		BUTTON_SIZE,
		buttonPosition,
		cardPosition,
		CARD_WIDTH,
		inHotZone
	} from '../../lib/ai/selectionPrompt';
	import { screenRect } from '../../lib/selecting/outline';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();
	const prompt = ctx.aiSelectionPrompt;

	let root: HTMLElement | undefined = $state();
	let card: HTMLElement | undefined = $state();
	let field: HTMLTextAreaElement | undefined = $state();
	let pointer: { x: number; y: number } | null = $state(null);
	let pointerPressed = $state(false);

	const isOpen = $derived(prompt.isOpen);
	const run = $derived(prompt.runView());

	const placement = $derived.by(() => {
		if (!isOpen && !prompt.available) return undefined;
		const bounds = prompt.anchorBounds();
		if (bounds === undefined) return undefined;
		const selection = screenRect(bounds, (point) => ctx.viewport.worldToScreen(point));
		const canvas = ctx.viewport.size;
		const button = buttonPosition(selection, canvas);
		return { selection, button, card: cardPosition(button, canvas) };
	});

	const buttonVisible = $derived.by(() => {
		if (placement === undefined) return false;
		if (isOpen) return true;
		if (pointer === null || pointerPressed) return false;
		return inHotZone(pointer, placement.selection, placement.button);
	});

	$effect(() => {
		if (!isOpen) return;
		void tick().then(() => field?.focus());
	});

	function onPointerMove(event: PointerEvent): void {
		pointerPressed = event.buttons !== 0;
		if (!root) return;
		const area = root.getBoundingClientRect();
		pointer = { x: event.clientX - area.left, y: event.clientY - area.top };
	}

	// A press outside the card closes it, unless its run is still going.
	function onPointerDown(event: PointerEvent): void {
		if (!isOpen || !card) return;
		if (event.target instanceof Node && card.contains(event.target)) return;
		if (run?.running === true) return;
		prompt.close();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			prompt.close();
			return;
		}
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		prompt.send();
	}
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerdowncapture={onPointerDown}
	onpointerup={() => (pointerPressed = false)}
/>

<div class="pointer-events-none absolute inset-0" bind:this={root} data-ai-selection-prompt>
	{#if placement !== undefined && buttonVisible && !isOpen}
		<button
			type="button"
			class="bg-blue pointer-events-auto absolute flex items-center justify-center rounded-lg text-white shadow-md hover:opacity-90"
			style:left="{placement.button.x}px"
			style:top="{placement.button.y}px"
			style:height="{BUTTON_SIZE}px"
			style:width="{BUTTON_SIZE}px"
			aria-label="Ask AI about the selection"
			title="Ask AI about the selection"
			data-ai-selection-button
			onpointerdown={(event) => event.stopPropagation()}
			onclick={() => prompt.open()}
		>
			<SparkleIcon size={16} weight="fill" />
		</button>
	{/if}

	{#if placement !== undefined && isOpen}
		<div
			bind:this={card}
			class="bg-elevated border-line pointer-events-auto absolute flex flex-col gap-2 rounded-xl border p-2 shadow-lg"
			style:left="{placement.card.x}px"
			style:top="{placement.card.y}px"
			style:width="{CARD_WIDTH}px"
			data-ai-selection-card
		>
			{#if run !== undefined}
				<div class="flex items-start gap-2 px-1 text-xs" data-ai-selection-status>
					{#if run.running}
						<span class="text-muted flex-1">Working…</span>
						<button
							type="button"
							class="text-muted hover:text-default flex items-center gap-1"
							onclick={() => void prompt.stop()}
						>
							<StopIcon size={12} />
							Stop
						</button>
					{:else}
						<p class="text-default line-clamp-4 flex-1 [overflow-wrap:anywhere]">{run.answer}</p>
					{/if}
				</div>
				<button
					type="button"
					class="text-muted hover:text-default self-start px-1 text-[11px] underline"
					onclick={() => prompt.showInChat()}
				>
					Open in chat
				</button>
			{/if}
			<textarea
				bind:this={field}
				class="text-default placeholder:text-faint min-h-12 w-full resize-none bg-transparent px-1 text-xs outline-none"
				placeholder="Tell the AI what to do with the selection"
				aria-label="Ask AI about the selection"
				rows="2"
				value={prompt.draft}
				oninput={(event) => prompt.setDraft(event.currentTarget.value)}
				onkeydown={onKeydown}></textarea>
			<div class="flex justify-end">
				<IconButton
					icon={ArrowUpIcon}
					label="Send"
					variant="primary"
					onclick={() => prompt.send()}
				/>
			</div>
		</div>
	{/if}
</div>
