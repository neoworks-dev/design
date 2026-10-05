<script lang="ts">
	import { LoadingSpinner } from '@neoworks-dev/ui';
	import BookOpenIcon from 'phosphor-svelte/lib/BookOpenIcon';
	import CameraIcon from 'phosphor-svelte/lib/CameraIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import SlidersIcon from 'phosphor-svelte/lib/SlidersIcon';
	import TerminalIcon from 'phosphor-svelte/lib/TerminalIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import type { Component } from 'svelte';
	import { formatToolText, toolInputView, type ChatRow } from '../../lib/ai/chatRows';

	type ToolRow = Extract<ChatRow, { kind: 'tool' }>;

	interface Props {
		row: ToolRow;
		expanded: boolean;
		ontoggle: () => void;
	}

	let { row, expanded, ontoggle }: Props = $props();

	const ICONS: Record<string, Component> = {
		read: EyeIcon,
		write: CodeIcon,
		edit: SlidersIcon,
		screenshot: CameraIcon,
		skill: BookOpenIcon,
		run_command: TerminalIcon
	};

	const TITLES: Record<string, string> = {
		read: 'Read',
		write: 'Write',
		edit: 'Edit',
		screenshot: 'Screenshot',
		skill: 'Skill',
		run_command: 'Command'
	};

	const Icon = $derived(ICONS[row.name] ?? WrenchIcon);
	const title = $derived(TITLES[row.name] ?? row.name);
	const failed = $derived(row.status === 'failed' || row.output?.ok === false);
	const input = $derived(toolInputView(row.input));
</script>

<div
	class={[
		'bg-elevated overflow-hidden rounded-md border text-xs',
		failed ? 'border-red/40' : 'border-line'
	]}
	data-ai-tool={row.name}
	data-tool-status={row.status}
>
	<button
		type="button"
		class="hover:bg-hover flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left"
		aria-expanded={expanded}
		onclick={ontoggle}
	>
		<span class="text-faint inline-flex transition-transform" class:rotate-90={expanded}>
			<CaretRightIcon size={10} />
		</span>
		<span class="text-muted inline-flex"><Icon size={13} /></span>
		<span class="text-default shrink-0 font-medium">{title}</span>
		<span class="text-muted min-w-0 flex-1 truncate" title={row.summary}>{row.summary}</span>
		{#if row.status === 'running'}
			<LoadingSpinner size={11} class="text-muted shrink-0" label="Running" />
		{:else if failed}
			<span class="text-red inline-flex shrink-0" title="Failed"><WarningIcon size={12} /></span>
		{:else}
			<span class="text-green inline-flex shrink-0" title="Done"><CheckIcon size={12} /></span>
		{/if}
	</button>

	{#if expanded}
		<div class="border-line flex flex-col gap-2 border-t px-2 py-2" data-ai-tool-detail>
			{#if input.blocks.length > 0 || input.rest !== null}
				<section class="flex flex-col gap-1">
					<h4 class="text-faint text-[10px] font-medium tracking-wide uppercase">Input</h4>
					{#each input.blocks as block (block.key)}
						<div class="text-faint text-[10px]">{block.key}</div>
						<pre class="tool-code">{block.text}</pre>
					{/each}
					{#if input.rest !== null}
						<pre class="tool-code">{input.rest}</pre>
					{/if}
				</section>
			{/if}
			<section class="flex flex-col gap-1">
				<h4 class="text-faint text-[10px] font-medium tracking-wide uppercase">Output</h4>
				{#if row.output === null}
					<p class="text-faint text-[11px]">
						{row.status === 'running' ? 'Waiting for the answer…' : 'No answer recorded.'}
					</p>
				{:else if row.output.image !== null}
					<img
						class="border-line max-h-64 self-start rounded border object-contain"
						src={row.output.image.src}
						alt="Screenshot the assistant took"
						width={row.output.image.width}
						height={row.output.image.height}
						style:height="auto"
						style:max-width="100%"
					/>
					<p class="text-faint text-[10px]">{row.output.text}</p>
				{:else}
					<pre class={['tool-code', !row.output.ok && 'text-red']}>{formatToolText(
							row.output.text
						)}</pre>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	.tool-code {
		max-height: 16rem;
		overflow: auto;
		border-radius: 0.25rem;
		background: var(--color-raised);
		padding: 0.375rem 0.5rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--color-default);
	}
</style>
