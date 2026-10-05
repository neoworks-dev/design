<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';

	// A one-line prompt for the link of the selected text: Enter applies (empty removes the link),
	// Escape cancels. Floats at the top of the canvas.
	const ctx = getKernel();
	const format = ctx.textFormat;

	let url = $state('');
	if (format.state.linkPrompt) url = format.state.linkPrompt.url;
	let field = $state<HTMLInputElement>();

	$effect(() => {
		if (!field) return;
		field.focus();
		field.select();
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			format.closeLinkPrompt(true, url);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			format.closeLinkPrompt(false);
		}
	}
</script>

<div
	class="border-line bg-elevated pointer-events-auto absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border px-3 py-2 shadow-md"
	data-link-prompt
>
	<label class="text-muted text-xs" for="text-link-url">Link</label>
	<input
		id="text-link-url"
		bind:this={field}
		bind:value={url}
		class="bg-input border-line text-default w-72 rounded-sm border px-2 py-1 text-sm outline-none"
		placeholder="https://"
		spellcheck="false"
		onkeydown={onKeydown}
	/>
</div>
