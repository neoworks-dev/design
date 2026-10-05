<script lang="ts">
	// Renders one node of a plugin's declarative surface with the design system. Known node types
	// only: the host validated the tree, and a type this switch does not know renders nothing
	// (fail closed). Input goes back as `onEvent(handlerId, value, label)`.
	import { Button, Checkbox, Select } from '@neoworks-dev/ui';
	import type { SurfaceNode } from '../surface';
	import SurfaceNodeView from './SurfaceNodeView.svelte';

	let {
		node,
		onEvent
	}: {
		node: SurfaceNode;
		onEvent: (handler: string, value: unknown, label: string | undefined) => void;
	} = $props();

	const GAPS = { none: 'gap-0', sm: 'gap-1', md: 'gap-2', lg: 'gap-4' };
	const ALIGNS = {
		start: 'items-start',
		center: 'items-center',
		end: 'items-end',
		stretch: 'items-stretch'
	};
	const TONES = {
		default: 'text-default',
		muted: 'text-muted',
		faint: 'text-faint',
		danger: 'text-red',
		success: 'text-green'
	};
	const SIZES = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };
	const FIELD =
		'bg-input border-line text-default min-w-0 rounded-sm border px-2 py-1 text-xs outline-none';

	// Which tab is shown: the plugin's `value` while it controls it, the user's pick otherwise.
	let pickedTab = $state<string | undefined>(undefined);

	function send(handler: string | undefined, value: unknown, label?: string): void {
		if (handler !== undefined) onEvent(handler, value, label);
	}

	function inputValue(event: Event, numeric: boolean): string | number {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return '';
		if (!numeric) return target.value;
		return target.valueAsNumber;
	}

	function colorValue(event: Event): string {
		const target = event.currentTarget;
		if (target instanceof HTMLInputElement) return target.value;
		return '';
	}

	function checkedValue(event: Event): boolean {
		const target = event.currentTarget;
		return target instanceof HTMLInputElement && target.checked;
	}
</script>

{#if node.type === 'stack'}
	<div
		class={[
			'flex min-w-0',
			node.direction === 'row' ? 'flex-row' : 'flex-col',
			GAPS[node.gap ?? 'md'],
			ALIGNS[node.align ?? (node.direction === 'row' ? 'center' : 'stretch')]
		]}
	>
		{#each node.children as child, index (index)}
			<SurfaceNodeView node={child} {onEvent} />
		{/each}
	</div>
{:else if node.type === 'section'}
	<section class="flex min-w-0 flex-col gap-2">
		{#if node.title}
			<h3 class="text-muted text-xs font-semibold">{node.title}</h3>
		{/if}
		{#each node.children as child, index (index)}
			<SurfaceNodeView node={child} {onEvent} />
		{/each}
	</section>
{:else if node.type === 'text'}
	<p
		class={[
			'min-w-0 break-words whitespace-pre-wrap',
			TONES[node.tone ?? 'default'],
			SIZES[node.size ?? 'sm'],
			node.bold && 'font-semibold'
		]}
	>
		{node.text}
	</p>
{:else if node.type === 'divider'}
	<hr class="border-line-faint" />
{:else if node.type === 'button'}
	<Button
		variant={node.variant ?? 'surface'}
		size={node.size ?? 'sm'}
		full={node.full ?? false}
		disabled={node.disabled ?? false}
		onclick={() => send(node.onClick, undefined, node.label)}
	>
		{node.label}
	</Button>
{:else if node.type === 'input'}
	<label class="flex min-w-0 flex-col gap-1">
		{#if node.label}<span class="text-muted text-xs">{node.label}</span>{/if}
		<input
			class={FIELD}
			type={node.inputType === 'number' ? 'number' : 'text'}
			value={node.value}
			placeholder={node.placeholder}
			min={node.min}
			max={node.max}
			step={node.step}
			disabled={node.disabled}
			onchange={(event) => send(node.onChange, inputValue(event, node.inputType === 'number'))}
		/>
	</label>
{:else if node.type === 'select'}
	<div class="flex min-w-0 flex-col gap-1">
		{#if node.label}<span class="text-muted text-xs">{node.label}</span>{/if}
		<Select
			value={node.value}
			options={node.options}
			disabled={node.disabled ?? false}
			size="sm"
			onChange={(value) => send(node.onChange, value)}
		/>
	</div>
{:else if node.type === 'color'}
	<label class="flex min-w-0 items-center gap-2">
		<input
			type="color"
			class="border-line size-6 shrink-0 cursor-pointer rounded border bg-transparent p-0"
			value={node.value}
			onchange={(event) => send(node.onChange, colorValue(event))}
		/>
		{#if node.label}<span class="text-muted text-xs">{node.label}</span>{/if}
	</label>
{:else if node.type === 'checkbox'}
	<label class="text-default flex min-w-0 items-center gap-2 text-xs">
		<Checkbox
			checked={node.checked}
			size="sm"
			disabled={node.disabled}
			onchange={(event: Event) => send(node.onChange, checkedValue(event))}
		/>
		{node.label}
	</label>
{:else if node.type === 'list'}
	<ul class="divide-line-faint flex min-w-0 flex-col divide-y">
		{#each node.children as child, index (index)}
			<li class="py-1.5"><SurfaceNodeView node={child} {onEvent} /></li>
		{/each}
	</ul>
{:else if node.type === 'image'}
	<img
		src={node.src}
		alt={node.alt}
		width={node.width}
		height={node.height}
		class="max-w-full rounded-sm"
	/>
{:else if node.type === 'tabs'}
	{@const active = node.value ?? pickedTab ?? node.children[0]?.id}
	<div class="flex min-w-0 flex-col gap-2">
		<div role="tablist" class="border-line-faint flex gap-1 border-b">
			{#each node.children as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={tab.id === active}
					class={[
						'hover:text-default -mb-px border-b-2 px-2 py-1 text-xs font-medium',
						tab.id === active ? 'border-action text-default' : 'text-dim border-transparent'
					]}
					onclick={() => {
						pickedTab = tab.id;
						send(node.onChange, tab.id);
					}}
				>
					{tab.label}
				</button>
			{/each}
		</div>
		{#each node.children as tab (tab.id)}
			{#if tab.id === active}
				<SurfaceNodeView node={tab} {onEvent} />
			{/if}
		{/each}
	</div>
{:else if node.type === 'tab'}
	<div class="flex min-w-0 flex-col gap-2" role="tabpanel" aria-label={node.label}>
		{#each node.children as child, index (index)}
			<SurfaceNodeView node={child} {onEvent} />
		{/each}
	</div>
{/if}
