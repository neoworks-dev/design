<script lang="ts">
	import { Select } from '@neoworks-dev/ui';
	import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	const ctx = getKernel();

	const percent = $derived(Math.round(ctx.viewport.zoom * 100));
	const selected = $derived(ctx.selection.nodes());

	const ZOOM_OPTIONS = [
		{ value: '0.5', label: '50%' },
		{ value: '1', label: '100%' },
		{ value: '2', label: '200%' },
		{ value: 'fit', label: 'Zoom to fit' },
		{ value: 'selection', label: 'Zoom to selection' }
	];

	const title = $derived.by(() => {
		if (selected.length === 0) return ctx.document.currentPage.name;
		if (selected.length === 1) return selected[0].name;
		return `${selected.length} layers`;
	});

	const kind = $derived.by(() => {
		if (selected.length !== 1) return '';
		return selected[0].type.toLowerCase().replaceAll('_', ' ');
	});

	function chooseZoom(value: string | string[]): void {
		if (typeof value !== 'string') return;
		if (value === 'fit') ctx.viewport.zoomToFit();
		else if (value === 'selection') ctx.viewport.zoomToSelection();
		else ctx.viewport.zoomTo(Number(value));
	}
</script>

<div class="border-line-faint border-b" data-design-header>
	<div class="flex h-10 items-center justify-between gap-2 px-3">
		<!-- Avatar and present slots stay empty offline; plugins fill them later. -->
		<div class="w-24" data-zoom-dropdown>
			<Select
				options={ZOOM_OPTIONS}
				value=""
				placeholder="{percent}%"
				size="sm"
				variant="ghost"
				onChange={chooseZoom}
			/>
		</div>
		<IconToggleButton
			icon={CodeIcon}
			label="Dev Mode"
			title="Dev Mode (Shift+D)"
			pressed={ctx.panels.mode === 'dev'}
			onclick={() => void ctx.commands.run('panels.toggle-dev-mode')}
		/>
	</div>
	<div class="flex items-baseline gap-2 px-3 pb-2" data-node-header>
		<span class="text-default min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
		{#if kind !== ''}
			<span class="text-faint text-xs capitalize">{kind}</span>
		{/if}
	</div>
</div>
