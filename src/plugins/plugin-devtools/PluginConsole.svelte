<script lang="ts">
	// The plugin console: what plugins print and the errors of their code, newest at the bottom.
	import { Button, Select } from '@neoworks-dev/ui';
	import { tick } from 'svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';
	import type { ConsoleLevel } from '../../lib/services/pluginConsoleState.svelte';

	const ctx = getKernel();
	const devtools = ctx.pluginConsole;
	const ALL = '*';
	const lines = $derived(devtools.lines());
	const filterOptions = $derived([
		{ value: ALL, label: 'All plugins' },
		...devtools.pluginIds().map((id) => ({ value: id, label: id }))
	]);

	let list: HTMLElement | undefined = $state();

	const LEVEL_CLASSES: Record<ConsoleLevel, string> = {
		info: 'text-default',
		warn: 'text-amber',
		error: 'text-red',
		system: 'text-muted italic'
	};

	$effect(() => {
		void lines.length;
		if (!devtools.isOpen) return;
		void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
	});

	function time(at: number): string {
		return new Date(at).toLocaleTimeString([], { hour12: false });
	}
</script>

{#if devtools.isOpen}
	<section
		class="bg-elevated border-line pointer-events-auto fixed right-0 bottom-0 left-0 z-40 flex h-60 flex-col border-t shadow-lg"
		aria-label="Plugin console"
		data-plugin-console
	>
		<header class="border-line-faint flex h-9 shrink-0 items-center gap-3 border-b px-3">
			<h2 class="text-default text-xs font-semibold">Plugin console</h2>
			<div class="w-44">
				<Select
					size="sm"
					value={devtools.filter === null ? ALL : devtools.filter}
					options={filterOptions}
					onChange={(value) => devtools.setFilter(value === ALL ? null : String(value))}
				/>
			</div>
			<span class="flex-1"></span>
			<Button size="sm" variant="ghost" onclick={() => devtools.clear()}>Clear</Button>
			<button
				type="button"
				aria-label="Close console"
				class="text-muted hover:text-default rounded-sm p-1"
				onclick={() => devtools.closeConsole()}
			>
				<XIcon size={14} />
			</button>
		</header>
		<div
			bind:this={list}
			class="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-xs"
			role="log"
		>
			{#each lines as line (line.id)}
				<div class="flex gap-2 py-px" data-console-line={line.level}>
					<span class="text-faint shrink-0">{time(line.at)}</span>
					<span class="text-faint shrink-0">{line.pluginId}</span>
					<span class={['min-w-0 whitespace-pre-wrap', LEVEL_CLASSES[line.level]]}
						>{line.message}</span
					>
				</div>
			{:else}
				<p class="text-faint py-4 text-center">Nothing printed yet.</p>
			{/each}
		</div>
	</section>
{/if}
