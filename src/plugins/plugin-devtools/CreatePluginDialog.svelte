<script lang="ts">
	// "Create plugin": a name and a template, written into the user plugins folder.
	import { Button, Select } from '@neoworks-dev/ui';
	import { tick } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import {
		PLUGIN_TEMPLATES,
		suggestPluginId,
		TEMPLATE_DESCRIPTIONS,
		type PluginTemplateKind
	} from '../../lib/plugins/templates';

	const ctx = getKernel();
	const devtools = ctx.pluginConsole;

	let name = $state('');
	let template = $state<PluginTemplateKind>('blank');
	let input: HTMLInputElement | undefined = $state();

	const options = PLUGIN_TEMPLATES.map((kind) => ({
		value: kind,
		label: `${kind}: ${TEMPLATE_DESCRIPTIONS[kind]}`
	}));
	const id = $derived(suggestPluginId(name));

	$effect(() => {
		if (devtools.createOpen) void tick().then(() => input?.focus());
	});

	function submit(): void {
		void devtools.create(name, template);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!devtools.createOpen) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			devtools.closeCreate();
		} else if (event.key === 'Enter' && event.target === input) {
			event.preventDefault();
			submit();
		}
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if devtools.createOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) devtools.closeCreate();
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Create plugin"
			class="bg-elevated border-line flex w-[420px] max-w-[94vw] flex-col gap-3 rounded-xl border p-4 shadow-lg"
			data-create-plugin
		>
			<h2 class="text-default text-sm font-semibold">Create plugin</h2>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">Name</span>
				<input
					bind:this={input}
					bind:value={name}
					type="text"
					placeholder="My plugin"
					class="bg-input border-line text-default rounded-sm border px-2 py-1 text-xs outline-none"
				/>
				{#if id !== ''}<span class="text-faint text-2xs">Id and folder: {id}</span>{/if}
			</label>
			<div class="flex flex-col gap-1">
				<span class="text-muted text-xs">Template</span>
				<Select
					size="sm"
					value={template}
					{options}
					onChange={(value) => (template = value as PluginTemplateKind)}
				/>
			</div>
			{#if devtools.notice}
				<p class={['text-xs', devtools.notice.error ? 'text-red' : 'text-muted']} role="status">
					{devtools.notice.text}
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button size="sm" variant="ghost" onclick={() => devtools.closeCreate()}>Cancel</Button>
				<Button size="sm" variant="primary" disabled={id === ''} onclick={submit}>Create</Button>
			</div>
		</div>
	</div>
{/if}
