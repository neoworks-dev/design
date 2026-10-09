<script lang="ts">
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { tick } from 'svelte';
	import { imageOfFile, imageUrl, PROMPT_IMAGE_TYPES } from '../../lib/ai/images';
	import {
		BUTTON_SIZE,
		buttonPosition,
		cardPosition,
		CARD_WIDTH,
		inHotZone,
		PROMPT_ADD_MENU,
		PROMPT_SUGGESTIONS_MENU
	} from '../../lib/ai/selectionPrompt';
	import { screenRect } from '../../lib/selecting/outline';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const MAXIMUM_SUGGESTIONS = 4;

	const ctx = getKernel();
	const prompt = ctx.aiSelectionPrompt;

	let root: HTMLElement | undefined = $state();
	let card: HTMLElement | undefined = $state();
	let field: HTMLTextAreaElement | undefined = $state();
	let pointer: { x: number; y: number } | null = $state(null);
	let pointerPressed = $state(false);
	let picker: HTMLInputElement | undefined = $state();
	let focused = $state(false);
	let imageError = $state('');
	let handledPickRequests = prompt.imagePickRequests;

	const isOpen = $derived(prompt.isOpen);
	const run = $derived(prompt.runView());
	const suggestions = $derived(
		ctx.menus
			.resolve(PROMPT_SUGGESTIONS_MENU)
			.filter((item) => item.command !== undefined)
			.slice(0, MAXIMUM_SUGGESTIONS)
	);
	const showSuggestions = $derived(
		focused && prompt.draft === '' && run === undefined && suggestions.length > 0
	);

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

	$effect(() => {
		const requests = prompt.imagePickRequests;
		if (requests === handledPickRequests) return;
		handledPickRequests = requests;
		picker?.click();
	});

	async function onPicked(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
		const files = [...(event.currentTarget.files ?? [])];
		event.currentTarget.value = '';
		imageError = '';
		for (const file of files) {
			try {
				prompt.addImage(await imageOfFile(file));
			} catch (error) {
				imageError = error instanceof Error ? error.message : String(error);
			}
		}
		field?.focus();
	}

	function openAddMenu(event: MouseEvent): void {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		ctx.menus.openMenu(PROMPT_ADD_MENU, { x: rect.left, y: rect.bottom + 6 });
	}

	function runSuggestion(command: string, args: unknown): void {
		prompt.close();
		void ctx.commands.run(command, args).catch((error: unknown) => ctx.logger.error(error));
	}

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
		// The plus menu is a popup outside the card.
		if (
			event.target instanceof Element &&
			event.target.closest('[data-menu-backdrop], [data-menu-popup]')
		)
			return;
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
			class="bg-elevated border-line pointer-events-auto absolute flex flex-col rounded-2xl border shadow-lg"
			style:left="{placement.card.x}px"
			style:top="{placement.card.y}px"
			style:width="{CARD_WIDTH}px"
			data-ai-selection-card
		>
			{#if run !== undefined}
				<div class="flex flex-col gap-1 px-4 pt-3" data-ai-selection-status>
					<div class="flex items-start gap-2 text-xs">
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
						class="text-muted hover:text-default self-start text-[11px] underline"
						onclick={() => prompt.showInChat()}
					>
						Open in chat
					</button>
				</div>
			{/if}
			{#if prompt.images.length > 0}
				<div class="flex flex-wrap gap-1.5 px-3 pt-3" data-ai-selection-images>
					{#each prompt.images as image, index (index)}
						<div class="group relative">
							<img
								src={imageUrl(image)}
								alt="Attached"
								class="border-line size-12 rounded-md border object-cover"
							/>
							<button
								type="button"
								class="bg-elevated border-line text-muted hover:text-default absolute -top-1.5 -right-1.5 hidden rounded-full border p-0.5 group-hover:block"
								aria-label="Remove image"
								onclick={() => prompt.removeImage(index)}
							>
								<XIcon size={9} />
							</button>
						</div>
					{/each}
				</div>
			{/if}
			{#if imageError !== ''}
				<p class="text-red px-4 pt-2 text-[11px]" data-ai-selection-image-error>{imageError}</p>
			{/if}
			<div class="flex items-center gap-1 p-2">
				{#if prompt.acceptsImages}
					<IconButton icon={PlusIcon} label="Add" onclick={openAddMenu} />
				{/if}
				<textarea
					bind:this={field}
					class="text-default placeholder:text-faint min-h-9 flex-1 resize-none self-center bg-transparent px-2 py-2 text-sm outline-none"
					placeholder="Ask for changes"
					aria-label="Ask AI about the selection"
					rows="1"
					value={prompt.draft}
					onfocus={() => (focused = true)}
					onblur={() => (focused = false)}
					oninput={(event) => prompt.setDraft(event.currentTarget.value)}
					onkeydown={onKeydown}></textarea>
				<IconButton
					icon={ArrowUpIcon}
					label="Send"
					variant="primary"
					onclick={() => prompt.send()}
				/>
			</div>
			{#if showSuggestions}
				<!-- mousedown keeps the textarea focused, or the list would vanish before the click -->
				<div
					role="presentation"
					class="border-line flex flex-col gap-0.5 border-t p-2"
					data-ai-selection-suggestions
					onmousedown={(event) => event.preventDefault()}
				>
					{#each suggestions as item (item.id)}
						{@const Icon = item.icon}
						{@const command = item.command ?? ''}
						<button
							type="button"
							class="text-default hover:bg-hover flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs"
							onclick={() => runSuggestion(command, item.args)}
						>
							{#if Icon}<Icon size={16} />{/if}
							{item.title}
						</button>
					{/each}
				</div>
			{/if}
			<input
				bind:this={picker}
				type="file"
				class="hidden"
				accept={PROMPT_IMAGE_TYPES.join(',')}
				multiple
				onchange={onPicked}
			/>
		</div>
	{/if}
</div>
