<script lang="ts">
	import { Select } from '@neoworks-dev/ui';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CrosshairIcon from 'phosphor-svelte/lib/CrosshairIcon';
	import OpenAiLogoIcon from 'phosphor-svelte/lib/OpenAiLogoIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import PiIcon from 'phosphor-svelte/lib/PiIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { tick, type Component } from 'svelte';
	import { chatRowsOf } from '../../lib/ai/chatRows';
	import { imageOfFile, imageUrl, pastedImageFiles } from '../../lib/ai/images';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';
	import ChatMarkdown from './ChatMarkdown.svelte';
	import ClaudeLogo from './ClaudeLogo.svelte';
	import ToolCard from './ToolCard.svelte';

	const ctx = getKernel();
	const chat = ctx.aiChat;

	const conversation = $derived(chat.conversation());
	const revertibleRunId = $derived(chat.revertibleRunId);
	const placeholder = $derived.by(() => {
		const hints = chat.slashHints();
		if (hints.length === 0) return 'Ask for changes';
		return `Ask for changes, or ${hints.join(' ')}`;
	});
	let scroller: HTMLElement | undefined = $state();
	let imageError = $state('');

	// phosphor icons and ClaudeLogo share the props `Select` passes to option icons.
	// oxlint-disable-next-line typescript/no-explicit-any
	const HARNESS_ICONS: Record<string, Component<any>> = {
		claude: ClaudeLogo,
		codex: OpenAiLogoIcon,
		pi: PiIcon
	};

	const providerOptions = $derived(
		chat.providerOptions().map((option) => ({ ...option, icon: harnessIcon(option.value) }))
	);
	const modelOptions = $derived(chat.modelOptions());
	const effortOptions = $derived(
		chat.effortOptions().map((option) => ({ ...option, icon: BrainIcon }))
	);

	// oxlint-disable-next-line typescript/no-explicit-any
	function harnessIcon(providerId: string): Component<any> {
		const icon = HARNESS_ICONS[providerId];
		if (icon === undefined) return RobotIcon;
		return icon;
	}

	function matchesQuery(option: { label: string }, query: string): boolean {
		return option.label.toLowerCase().includes(query.trim().toLowerCase());
	}

	async function onPaste(event: ClipboardEvent): Promise<void> {
		if (!chat.acceptsImages) return;
		const files = pastedImageFiles(event.clipboardData);
		if (files.length === 0) return;
		event.preventDefault();
		imageError = '';
		for (const file of files) {
			try {
				chat.addImage(await imageOfFile(file));
			} catch (error) {
				imageError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	$effect(() => {
		void chat.loadProviders();
	});

	// Keep the newest output in view while it streams.
	$effect(() => {
		void conversation.map((record) => record.events.length + record.status);
		void tick().then(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		chat.send();
	}

	function runLabel(status: string): string {
		if (status === 'running') return 'Working…';
		if (status === 'cancelled') return 'Stopped';
		if (status === 'error') return 'Failed';
		return '';
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-ai-chat>
	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3" bind:this={scroller}>
		{#if conversation.length === 0}
			<p class="text-muted py-6 text-center text-xs" data-ai-empty>
				Ask for changes to this design. Everything the assistant does can be undone in one step.
			</p>
		{/if}

		{#each conversation as record (record.id)}
			{@const rows = chatRowsOf(record)}
			<section class="flex flex-col gap-2" data-ai-run={record.id} data-status={record.status}>
				<div
					class="bg-raised text-default max-w-[88%] self-end rounded-lg px-3 py-2 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap"
					data-ai-user-message
				>
					{#if record.images.length > 0}
						<div class="mb-1.5 flex flex-wrap justify-end gap-1">
							{#each record.images as image, index (index)}
								<img
									src={imageUrl(image)}
									alt="Pasted"
									class="border-line h-16 max-w-32 rounded-md border object-cover"
								/>
							{/each}
						</div>
					{/if}
					{record.display === undefined ? record.prompt : record.display}
				</div>

				{#each rows as row (row.key)}
					{#if row.kind === 'thought'}
						<div class="text-xs">
							<button
								type="button"
								class="text-muted hover:text-default flex items-center gap-1"
								aria-expanded={chat.isExpanded(row.key)}
								onclick={() => chat.toggleRow(row.key)}
							>
								<span class="inline-flex" class:rotate-90={chat.isExpanded(row.key)}>
									<CaretRightIcon size={10} />
								</span>
								Reasoning
							</button>
							{#if chat.isExpanded(row.key)}
								<p
									class="text-muted border-line mt-1 ml-1 border-l pl-2.5 [overflow-wrap:anywhere] whitespace-pre-wrap"
								>
									{row.text}
								</p>
							{/if}
						</div>
					{:else if row.kind === 'tool'}
						<ToolCard
							{row}
							expanded={chat.isExpanded(row.key)}
							ontoggle={() => chat.toggleRow(row.key)}
						/>
					{:else if row.kind === 'text'}
						<ChatMarkdown text={row.text} />
					{:else if row.kind === 'edit'}
						<p
							class="bg-violet-soft text-violet flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[11px]"
							data-ai-edit
						>
							<PencilSimpleIcon size={11} />
							Changed {row.nodeCount} layer{row.nodeCount === 1 ? '' : 's'}: {row.label}
						</p>
					{:else}
						<p class="text-red text-xs [overflow-wrap:anywhere]" data-ai-error>{row.message}</p>
					{/if}
				{/each}

				<div class="text-muted flex items-center gap-3 text-[11px]">
					{#if runLabel(record.status) !== ''}
						<span data-ai-status>{runLabel(record.status)}</span>
					{/if}
					{#if record.status === 'error' || record.status === 'cancelled'}
						<button
							type="button"
							class="hover:text-default underline"
							disabled={chat.running}
							onclick={() => chat.retry(record.id)}
						>
							Retry
						</button>
					{/if}
					{#if revertibleRunId === record.id}
						<button
							type="button"
							class="hover:text-default underline"
							data-ai-undo
							onclick={() => chat.undoRun(record.id)}
						>
							Undo this run
						</button>
					{:else if chat.historyStateOf(record.id) === 'undone' || chat.historyStateOf(record.id) === 'reverted'}
						<span data-ai-undone>Undone</span>
					{/if}
				</div>
			</section>
		{/each}
	</div>

	{#if chat.awaitingConsent || chat.needsConsent}
		<div
			class="bg-raised border-line mx-3 mb-2 flex flex-col gap-2 rounded-lg border p-2 text-xs"
			data-ai-consent
		>
			<p class="text-muted">
				The assistant reads and edits this document through a model. Allow sending its content to
				the model you picked, for this document?
			</p>
			<button
				type="button"
				class="bg-action text-action-fg self-start rounded-md px-2 py-1 hover:opacity-90"
				onclick={() => chat.allowAndSend()}
			>
				Allow for this document
			</button>
		</div>
	{/if}

	<div
		class="bg-elevated border-line mx-3 mb-3 flex flex-col gap-2 rounded-xl border p-2"
		data-ai-composer
	>
		{#if chat.images.length > 0}
			<div class="flex flex-wrap gap-1.5 px-1 pt-1" data-ai-images>
				{#each chat.images as image, index (index)}
					<div class="group relative">
						<img
							src={imageUrl(image)}
							alt="Pasted"
							class="border-line h-12 w-12 rounded-md border object-cover"
						/>
						<button
							type="button"
							class="bg-elevated border-line text-muted hover:text-default absolute -top-1.5 -right-1.5 hidden rounded-full border p-0.5 group-hover:block"
							aria-label="Remove image"
							onclick={() => chat.removeImage(index)}
						>
							<XIcon size={9} />
						</button>
					</div>
				{/each}
			</div>
		{/if}
		{#if imageError !== ''}
			<p class="text-red px-1 text-[11px]" data-ai-image-error>{imageError}</p>
		{/if}
		<textarea
			class="text-default placeholder:text-faint min-h-14 w-full resize-none bg-transparent px-1 text-xs outline-none"
			{placeholder}
			aria-label="Message the assistant"
			rows="3"
			value={chat.draft}
			oninput={(event) => chat.setDraft(event.currentTarget.value)}
			onpaste={(event) => void onPaste(event)}
			onkeydown={onKeydown}></textarea>
		<div class="flex items-center gap-1">
			<IconButton
				icon={CrosshairIcon}
				label="Attach selection"
				pressed={chat.attachSelection}
				onclick={() => chat.setAttachSelection(!chat.attachSelection)}
			/>
			<div class="ml-auto">
				{#if chat.running}
					<IconButton
						icon={StopIcon}
						label="Stop"
						variant="primary"
						onclick={() => void chat.stop()}
					/>
				{:else}
					<IconButton
						icon={ArrowUpIcon}
						label="Send"
						variant="primary"
						onclick={() => chat.send()}
					/>
				{/if}
			</div>
		</div>
	</div>

	<div class="mx-2 -mt-1.5 mb-2 flex min-w-0 items-center" data-ai-pickers>
		{#if providerOptions.length > 0}
			<div class="shrink-0" data-ai-harness>
				<Select
					options={providerOptions}
					value={chat.providerId}
					placeholder="Harness"
					size="sm"
					variant="ghost"
					iconOnly
					onChange={(value) => {
						if (typeof value === 'string') chat.setProvider(value);
					}}
				/>
			</div>
		{/if}
		{#if modelOptions.length > 0}
			<div class="min-w-0 shrink" data-ai-model-picker>
				<Select
					options={modelOptions}
					value={chat.modelId}
					placeholder="Default"
					size="sm"
					variant="ghost"
					filter={modelOptions.length > 8 ? matchesQuery : undefined}
					searchPlaceholder="Search models"
					onChange={(value) => {
						if (typeof value === 'string') chat.setModel(value);
					}}
				/>
			</div>
		{:else}
			<span class="text-faint truncate px-2 text-[11px]" data-ai-model>{chat.modelLabel}</span>
		{/if}
		{#if effortOptions.length > 0}
			<div class="ml-auto shrink-0" data-ai-effort>
				<Select
					options={effortOptions}
					value={chat.effortId}
					placeholder="Effort"
					size="sm"
					variant="ghost"
					onChange={(value) => {
						if (typeof value === 'string') chat.setEffort(value);
					}}
				/>
			</div>
		{/if}
	</div>
</div>
