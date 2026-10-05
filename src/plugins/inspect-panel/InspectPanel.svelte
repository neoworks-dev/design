<script lang="ts">
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import { boxModelOf } from '../../lib/codegen/boxModel';
	import type { InstanceNode } from '../../lib/document';
	import type { CodegenService } from '../../lib/services/codegen';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import BoxModel from './BoxModel.svelte';
	import { compareWithMain, shortValue } from './compare';
	import { canMarkReady, isReadyForDev, planReadyForDev } from './readyForDev';

	let { codegen }: { codegen: CodegenService } = $props();

	const ctx = getKernel();

	const settings = $derived(codegen.settings);
	const ids = $derived(ctx.selection.ids);
	const nodeId = $derived(ids.length === 1 ? ids[0] : null);
	const node = $derived.by(() => {
		if (nodeId === null || !ctx.document.has(nodeId)) return null;
		return ctx.document.require(nodeId);
	});

	const languages = $derived(
		codegen.providers().map((provider) => ({ value: provider.id, label: provider.label }))
	);
	const provider = $derived(codegen.provider(settings.language));
	const blocks = $derived.by(() => {
		if (nodeId === null) return [];
		return codegen.generate(settings.language, nodeId);
	});
	const box = $derived(node === null ? null : boxModelOf(codegen.resolvedNode(node.id)));
	const ready = $derived(node !== null && isReadyForDev(node));
	const markable = $derived(node !== null && canMarkReady(ctx.document.reader, node));

	let comparing = $state(false);
	const differences = $derived.by(() => {
		if (node === null || node.type !== 'INSTANCE') return [];
		const instance: InstanceNode = node;
		if (!ctx.document.has(instance.mainComponentId)) return [];
		return compareWithMain(instance, ctx.document.require(instance.mainComponentId));
	});

	const VIEWS = [
		{ value: 'list', label: 'List' },
		{ value: 'code', label: 'Code' }
	];
	const UNITS = [
		{ value: 'px', label: 'px' },
		{ value: 'rem', label: 'rem' }
	];

	interface PropertyRow {
		property: string;
		value: string;
	}

	function rowsOf(code: string): PropertyRow[] {
		return code
			.split('\n')
			.filter((line) => line.includes(':'))
			.map((line) => {
				const [property, ...rest] = line.replace(/;$/, '').split(':');
				return { property: property.trim(), value: rest.join(':').trim() };
			});
	}

	function copy(text: string): void {
		void navigator.clipboard.writeText(text);
	}

	function setReady(next: boolean): void {
		if (node === null) return;
		const changes = planReadyForDev(ctx.document.reader, node, next);
		if (changes.length === 0) return;
		ctx.document.apply(changes, {
			origin: 'user',
			label: next ? 'Mark ready for dev' : 'Remove ready for dev'
		});
	}

	function setView(value: string): void {
		if (value === 'list' || value === 'code') settings.view = value;
	}

	function setUnit(value: string): void {
		if (value === 'px' || value === 'rem') settings.unit = value;
	}
</script>

<div class="flex flex-col gap-3 p-3" data-inspect-panel>
	{#if node === null}
		<p class="text-faint text-xs">
			{ids.length > 1 ? 'Select a single layer to inspect it.' : 'Select a layer to inspect it.'}
		</p>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<span class="text-default min-w-0 flex-1 truncate text-xs font-semibold">{node.name}</span>
			<div class="w-28">
				<ToggleGroup name="Inspect view" options={VIEWS} value={settings.view} onchange={setView} />
			</div>
		</div>

		{#if markable}
			<button
				type="button"
				class="bg-raised text-default hover:bg-hover h-7 rounded-md px-2 text-xs"
				aria-pressed={ready}
				data-ready-for-dev
				onclick={() => setReady(!ready)}
			>
				{ready ? 'Ready for dev (remove)' : 'Mark as ready for dev'}
			</button>
		{/if}

		{#if node.type === 'INSTANCE'}
			<div class="flex flex-col gap-1" data-compare>
				<button
					type="button"
					class="bg-raised text-default hover:bg-hover h-7 rounded-md px-2 text-xs"
					aria-expanded={comparing}
					onclick={() => (comparing = !comparing)}
				>
					Compare with main component
				</button>
				{#if comparing}
					{#each differences as difference (difference.property)}
						<div class="flex items-baseline justify-between gap-2 text-xs">
							<span class="text-muted">{difference.property}</span>
							<span class="text-default truncate tabular-nums">
								{shortValue(difference.main)} to {shortValue(difference.instance)}
							</span>
						</div>
					{:else}
						<p class="text-faint text-xs">No differences from the main component</p>
					{/each}
				{/if}
			</div>
		{/if}

		{#if box !== null}
			<BoxModel {box} />
		{/if}

		<div class="flex items-center gap-1" data-code-settings>
			<div class="min-w-0 flex-1" data-language>
				<DropdownField
					options={languages}
					value={settings.language}
					onchange={(language) => (settings.language = language)}
				/>
			</div>
			{#if provider !== undefined && provider.usesUnit === true}
				<div class="w-24">
					<ToggleGroup name="Unit" options={UNITS} value={settings.unit} onchange={setUnit} />
				</div>
			{/if}
		</div>

		{#each blocks as block (block.title)}
			<div class="flex flex-col gap-1" data-code-block={block.title}>
				<div class="flex items-center justify-between">
					<span class="text-muted text-xs">{block.title}</span>
					<IconToggleButton
						icon={CopyIcon}
						label="Copy {block.title}"
						onclick={() => copy(block.code)}
					/>
				</div>
				{#if settings.view === 'code' || block.title === 'Variables'}
					<pre
						class="bg-input border-line text-default overflow-x-auto rounded-md border p-2 text-[11px]"
						data-code>{block.code}</pre>
				{:else}
					<div class="flex flex-col" data-property-list>
						{#each rowsOf(block.code) as row (row.property)}
							<button
								type="button"
								class="hover:bg-hover flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs"
								title="Copy {row.property}"
								onclick={() => copy(`${row.property}: ${row.value};`)}
							>
								<span class="text-muted">{row.property}</span>
								<span class="text-default truncate tabular-nums">{row.value}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>
