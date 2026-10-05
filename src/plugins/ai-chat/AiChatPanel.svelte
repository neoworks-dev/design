<script lang="ts">
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CrosshairIcon from 'phosphor-svelte/lib/CrosshairIcon';
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import { tick } from 'svelte';
	import { chatRowsOf } from '../../lib/ai/chatRows';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();
	const chat = ctx.aiChat;

	const conversation = $derived(chat.conversation());
	const revertibleRunId = $derived(chat.revertibleRunId);
	let scroller: HTMLElement | undefined = $state();

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
					{record.prompt}
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
								<p class="text-muted mt-1 pl-3 [overflow-wrap:anywhere] whitespace-pre-wrap">
									{row.text}
								</p>
							{/if}
						</div>
					{:else if row.kind === 'tool'}
						<div class="text-xs" data-ai-tool={row.name} data-tool-status={row.status}>
							<button
								type="button"
								class="text-muted hover:text-default flex items-center gap-1"
								aria-expanded={chat.isExpanded(row.key)}
								onclick={() => chat.toggleRow(row.key)}
							>
								<span class="inline-flex" class:rotate-90={chat.isExpanded(row.key)}>
									<CaretRightIcon size={10} />
								</span>
								<span class="font-mono">{row.name}</span>
								{#if row.status === 'running'}<span class="text-faint">…</span>{/if}
								{#if row.status === 'failed'}<span class="text-red">failed</span>{/if}
							</button>
							{#if chat.isExpanded(row.key) && row.detail !== ''}
								<p class="text-faint mt-1 pl-3 font-mono text-[10px] [overflow-wrap:anywhere]">
									{row.detail}
								</p>
							{/if}
						</div>
					{:else if row.kind === 'text'}
						<p class="text-default text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
							{row.text}
						</p>
					{:else if row.kind === 'edit'}
						<p class="text-muted text-[11px]" data-ai-edit>
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
		<textarea
			class="text-default placeholder:text-faint min-h-14 w-full resize-none bg-transparent px-1 text-xs outline-none"
			placeholder="Ask for changes"
			aria-label="Message the assistant"
			rows="3"
			value={chat.draft}
			oninput={(event) => chat.setDraft(event.currentTarget.value)}
			onkeydown={onKeydown}></textarea>
		<div class="flex items-center gap-1">
			<IconButton
				icon={CrosshairIcon}
				label="Attach selection"
				pressed={chat.attachSelection}
				onclick={() => chat.setAttachSelection(!chat.attachSelection)}
			/>
			<div class="ml-auto max-w-40 min-w-0">
				{#if chat.modelOptions().length > 0}
					<DropdownField
						options={chat.modelOptions()}
						value={chat.modelId === '' ? null : chat.modelId}
						placeholder={chat.modelLabel}
						onchange={(value) => chat.setModel(value)}
					/>
				{:else}
					<span class="text-faint truncate text-[11px]" data-ai-model>{chat.modelLabel}</span>
				{/if}
			</div>
			{#if chat.running}
				<IconButton
					icon={StopIcon}
					label="Stop"
					variant="primary"
					onclick={() => void chat.stop()}
				/>
			{:else}
				<IconButton icon={ArrowUpIcon} label="Send" variant="primary" onclick={() => chat.send()} />
			{/if}
		</div>
	</div>
</div>
