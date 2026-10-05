<script lang="ts">
	import { Button, StatusBadge } from '@neoworks-dev/ui';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();
	const history = ctx.versionHistory;

	let versionName = $state('');
	let nameInput: HTMLInputElement | undefined = $state();

	// The log grows as autosave persists edits; read it again whenever more were confirmed.
	$effect(() => {
		void ctx.fileSession.status.persisted;
		void history.refresh();
	});

	type Tone = 'blue' | 'violet' | 'green' | 'neutral';
	const ORIGIN_TONES: Record<string, Tone> = {
		user: 'blue',
		plugin: 'violet',
		ai: 'green',
		sync: 'neutral'
	};

	function toneOf(origin: string): Tone {
		const tone = ORIGIN_TONES[origin];
		if (tone === undefined) return 'neutral';
		return tone;
	}

	function when(milliseconds: number): string {
		return new Date(milliseconds).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	async function save(): Promise<void> {
		const mark = await history.saveVersion(versionName);
		if (mark === null) return;
		versionName = '';
		nameInput?.blur();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		void save();
	}
</script>

<div class="flex h-full min-h-0 flex-col text-xs" data-version-history>
	<div class="border-line-faint flex shrink-0 items-center gap-2 border-b p-3">
		<input
			type="text"
			aria-label="Version name"
			placeholder="Name this version"
			class="bg-raised border-line-faint text-default min-w-0 flex-1 rounded border px-2 py-1"
			bind:value={versionName}
			bind:this={nameInput}
			onkeydown={onKeydown}
		/>
		<Button
			size="sm"
			variant="primary"
			disabled={versionName.trim() === '' || history.busy}
			onclick={() => void save()}>Save</Button
		>
	</div>

	{#if history.notice !== null}
		<div
			role={history.notice.kind === 'error' ? 'alert' : 'status'}
			data-version-notice={history.notice.kind}
			class={[
				'border-line-faint flex shrink-0 items-start gap-2 border-b px-3 py-2',
				history.notice.kind === 'error' ? 'text-red' : 'text-muted'
			]}
		>
			<span class="min-w-0 flex-1">{history.notice.text}</span>
			<button
				type="button"
				class="text-muted hover:text-default shrink-0 underline"
				onclick={() => history.dismissNotice()}>Dismiss</button
			>
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if history.data === null}
			<p class="text-muted p-3" data-version-empty>
				{history.loading ? 'Loading...' : 'Open a document to see its history.'}
			</p>
		{:else}
			<h3 class="text-muted px-3 pt-3 pb-1 font-medium">Versions</h3>
			{#if history.marks.length === 0}
				<p class="text-faint px-3 py-1">No versions yet. Saving the file adds one.</p>
			{/if}
			<ul>
				{#each history.marks as mark (mark.id)}
					{@const restorable = history.isRestorable(mark.seq)}
					<li
						class="hover:bg-raised flex items-center gap-2 px-3 py-1.5"
						data-version-mark={mark.id}
						data-version-kind={mark.kind}
						data-restorable={restorable}
					>
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate font-medium">{mark.name}</span>
							<span class="text-faint">
								{when(mark.createdAt)}{#if mark.kind !== 'named'}
									&middot; automatic{/if}
							</span>
							{#if !restorable}
								<span class="text-amber" data-version-pruned>Pruned from the history</span>
							{/if}
						</div>
						<Button
							size="sm"
							variant="surface"
							disabled={!restorable || history.busy || history.isCurrent(mark.seq)}
							onclick={() => void history.restore(mark.seq, mark.name)}>Restore</Button
						>
						{#if mark.kind === 'named'}
							<IconButton
								icon={TrashIcon}
								label="Delete version"
								onclick={() => void history.deleteVersion(mark.id)}
							/>
						{/if}
					</li>
				{/each}
			</ul>

			<h3 class="text-muted px-3 pt-4 pb-1 font-medium">Changes</h3>
			{#if history.entries.length === 0}
				<p class="text-faint px-3 py-1" data-version-no-changes>
					{#if history.hasPrunedRange}All earlier changes were pruned.{:else}No changes yet.{/if}
				</p>
			{/if}
			<ul>
				{#each history.entries as entry (entry.seq)}
					<li
						class="hover:bg-raised flex items-center gap-2 px-3 py-1.5"
						data-version-entry={entry.seq}
					>
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">{entry.label}</span>
							<span class="text-faint">{when(entry.createdAt)}</span>
						</div>
						<span data-version-origin={entry.origin}>
							<StatusBadge tone={toneOf(entry.origin)}>{entry.origin}</StatusBadge>
						</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={history.busy || history.isCurrent(entry.seq)}
							onclick={() => void history.restore(entry.seq, entry.label)}>Restore</Button
						>
					</li>
				{/each}
			</ul>
			{#if history.hasPrunedRange}
				<p
					class="border-line-faint text-amber mx-3 my-2 rounded border p-2"
					data-version-pruned-range
				>
					Older changes were pruned (the log keeps the newest 1000 changes, at most 30 days).
					Versions before this point can no longer be restored.
				</p>
			{/if}
		{/if}
	</div>
</div>
