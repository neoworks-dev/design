<script lang="ts">
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import { OPEN_FILL, RESOLVED_FILL } from '../../lib/comments/draw';
	import type { CommentFilter } from '../../lib/comments/model';
	import { relativeTime } from '../../lib/home/format';
	import { getKernel } from '../../lib/kernel/context';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';

	const ctx = getKernel();
	const comments = ctx.comments;

	const listed = $derived(comments.listed());
	const total = $derived(comments.all().length);
	const now = Date.now();

	function emptyMessage(): string {
		if (total === 0) return 'No comments yet. Press C and click the canvas to add one.';
		return 'No comments match.';
	}

	const FILTERS: { value: CommentFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' }
	];
</script>

<div class="flex flex-col gap-2 p-3" data-comments-panel>
	<input
		class="bg-input border-line text-default h-7 w-full rounded border px-2 text-xs"
		placeholder="Search comments"
		aria-label="Search comments"
		value={comments.query}
		oninput={(event) => comments.setQuery(event.currentTarget.value)}
	/>
	<ToggleGroup
		name="Comment filter"
		value={comments.filter}
		options={FILTERS}
		onchange={(next) => {
			if (next === 'all' || next === 'open' || next === 'resolved') comments.setFilter(next);
		}}
	/>
	<label class="text-muted flex items-center gap-2 text-xs">
		<input
			type="checkbox"
			checked={comments.visible}
			onchange={(event) => comments.setVisible(event.currentTarget.checked)}
		/>
		Show comments on the canvas (Shift+C)
	</label>

	{#if listed.length === 0}
		<p class="text-muted py-6 text-center text-xs" data-comments-empty>{emptyMessage()}</p>
	{:else}
		<ul class="flex flex-col">
			{#each listed as comment (comment.id)}
				<li
					class="border-line-faint hover:bg-hover group flex items-start gap-2 border-b py-2"
					data-comment={comment.id}
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-start gap-2 text-left"
						aria-label="Go to comment {comment.number}: {comment.text}"
						onclick={() => comments.jumpTo(comment.id)}
					>
						<span
							class="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
							style:background-color={comment.resolved ? RESOLVED_FILL : OPEN_FILL}
						>
							{comment.number}
						</span>
						<span class="min-w-0">
							<span
								class="block text-xs [overflow-wrap:anywhere]"
								class:line-through={comment.resolved}
								class:text-muted={comment.resolved}
							>
								{comment.text}
							</span>
							<span class="text-faint block text-[10px]">
								{comment.pageName} · {relativeTime(comment.updatedAt, now)}
							</span>
						</span>
					</button>
					<button
						type="button"
						class="text-muted hover:text-default shrink-0 p-1"
						aria-label={comment.resolved ? 'Reopen comment' : 'Resolve comment'}
						aria-pressed={comment.resolved}
						onclick={() => comments.setResolved(comment.id, !comment.resolved)}
					>
						<CheckIcon size={12} weight="bold" />
					</button>
					<button
						type="button"
						class="text-muted hover:text-default shrink-0 p-1"
						aria-label="Delete comment"
						onclick={() => comments.remove(comment.id)}
					>
						<TrashIcon size={12} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
