<script lang="ts">
	import { renderMarkdown } from '../../lib/ai/markdown';

	interface Props {
		text: string;
	}

	let { text }: Props = $props();

	const html = $derived(renderMarkdown(text));
</script>

<!-- renderMarkdown sanitises: the HTML holds only formatting tags and safe links. -->
<div class="chat-markdown text-default text-xs" data-ai-markdown>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>

<style>
	.chat-markdown {
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.chat-markdown :global(> * + *) {
		margin-top: 0.5rem;
	}
	.chat-markdown :global(h1),
	.chat-markdown :global(h2),
	.chat-markdown :global(h3),
	.chat-markdown :global(h4) {
		font-weight: 600;
		margin-top: 0.75rem;
	}
	.chat-markdown :global(h1) {
		font-size: 0.95rem;
	}
	.chat-markdown :global(h2) {
		font-size: 0.875rem;
	}
	.chat-markdown :global(h3),
	.chat-markdown :global(h4) {
		font-size: 0.8rem;
	}
	.chat-markdown :global(strong) {
		font-weight: 600;
	}
	.chat-markdown :global(em) {
		font-style: italic;
	}
	.chat-markdown :global(a) {
		color: var(--color-blue);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.chat-markdown :global(ul),
	.chat-markdown :global(ol) {
		padding-left: 1.1rem;
	}
	.chat-markdown :global(ul) {
		list-style: disc;
	}
	.chat-markdown :global(ol) {
		list-style: decimal;
	}
	.chat-markdown :global(li + li) {
		margin-top: 0.15rem;
	}
	.chat-markdown :global(li > input) {
		margin-right: 0.35rem;
		vertical-align: middle;
	}
	.chat-markdown :global(code) {
		border-radius: 0.25rem;
		background: var(--color-raised);
		padding: 0.05rem 0.3rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.68rem;
	}
	.chat-markdown :global(pre) {
		overflow-x: auto;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		background: var(--color-raised);
		padding: 0.5rem 0.625rem;
	}
	.chat-markdown :global(pre code) {
		background: transparent;
		padding: 0;
		font-size: 0.66rem;
		line-height: 1.5;
	}
	.chat-markdown :global(blockquote) {
		border-left: 2px solid var(--color-line-strong);
		padding-left: 0.6rem;
		color: var(--color-muted);
	}
	.chat-markdown :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-line);
	}
	.chat-markdown :global(table) {
		display: block;
		overflow-x: auto;
		border-collapse: collapse;
	}
	.chat-markdown :global(th),
	.chat-markdown :global(td) {
		border: 1px solid var(--color-line);
		padding: 0.2rem 0.45rem;
		text-align: left;
	}
	.chat-markdown :global(th) {
		background: var(--color-raised);
		font-weight: 600;
	}
</style>
