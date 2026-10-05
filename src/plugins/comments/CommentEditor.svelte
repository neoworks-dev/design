<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import { tick, untrack } from 'svelte';
	import { relativeTime } from '../../lib/home/format';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const comments = ctx.comments;

	const EDITOR_WIDTH = 288;
	const EDITOR_HEIGHT = 190;
	const GAP = 18;

	const editor = $derived(comments.editor);
	const comment = $derived.by(() => {
		if (editor === null || editor.kind !== 'comment') return undefined;
		return comments.find(editor.id);
	});
	const draft = $derived(comments.draft);

	// Where the note opens: right of the pin, flipped to the left or clamped when it would leave
	// the canvas. The pin is read through the service, so the note follows it while the canvas pans.
	const placement = $derived.by(() => {
		let centre: { x: number; y: number } | undefined;
		if (comment !== undefined) centre = comments.bubbleCentre(comment);
		else if (draft !== null) centre = ctx.viewport.worldToScreen(draft.point);
		if (centre === undefined) return undefined;
		const size = ctx.viewport.size;
		let left = centre.x + GAP;
		if (left + EDITOR_WIDTH > size.width) left = centre.x - GAP - EDITOR_WIDTH;
		left = Math.max(8, left);
		const top = Math.max(8, Math.min(centre.y - 24, size.height - EDITOR_HEIGHT - 8));
		return { left, top };
	});

	let text = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	function editorKeyOf(target: typeof editor): string | null {
		if (target === null) return null;
		if (target.kind === 'draft') return 'draft';
		return target.id;
	}

	function textOf(note: typeof comment): string {
		if (note === undefined) return '';
		return note.text;
	}

	const editorKey = $derived(editorKeyOf(editor));

	// The text field follows whichever note is open, and only then: other edits to the document
	// must not overwrite what is being typed. Nothing is written until Save / Post.
	$effect(() => {
		if (editorKey === null) return;
		text = untrack(() => textOf(comment));
		void tick().then(() => textarea?.focus());
	});

	const changed = $derived(comment !== undefined && text.trim() !== comment.text);

	function submit(): void {
		if (comment === undefined) {
			comments.post(text);
			return;
		}
		comments.setText(comment.id, text);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			comments.closeEditor();
			return;
		}
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			submit();
		}
	}
</script>

{#if editor !== null && placement !== undefined}
	<div
		role="dialog"
		aria-label="Comment"
		data-comment-editor
		class="bg-elevated border-line text-default pointer-events-auto absolute z-20 flex flex-col gap-2 rounded-lg border p-3 shadow-lg"
		style:left="{placement.left}px"
		style:top="{placement.top}px"
		style:width="{EDITOR_WIDTH}px"
	>
		{#if comment !== undefined}
			<div class="text-muted flex items-center justify-between text-xs">
				<span>#{comment.number} on {comment.pageName}</span>
				<span>{relativeTime(comment.updatedAt, Date.now())}</span>
			</div>
		{:else}
			<div class="text-muted text-xs">New comment</div>
		{/if}
		<textarea
			bind:this={textarea}
			bind:value={text}
			{onkeydown}
			rows="4"
			placeholder="Add a comment"
			aria-label="Comment text"
			class="bg-input border-line text-default w-full resize-none rounded border p-2 text-xs"
		></textarea>
		<div class="flex items-center gap-2">
			{#if comment === undefined}
				<Button size="sm" variant="primary" disabled={text.trim() === ''} onclick={submit}>
					Post
				</Button>
				<Button size="sm" variant="ghost" onclick={() => comments.closeEditor()}>Cancel</Button>
			{:else}
				<Button size="sm" variant="primary" disabled={!changed} onclick={submit}>Save</Button>
				<Button
					size="sm"
					variant="surface"
					onclick={() => comments.setResolved(comment.id, !comment.resolved)}
				>
					{comment.resolved ? 'Reopen' : 'Resolve'}
				</Button>
				<div class="flex-1"></div>
				<Button size="sm" variant="ghost" onclick={() => comments.remove(comment.id)}>Delete</Button
				>
			{/if}
		</div>
	</div>
{/if}
