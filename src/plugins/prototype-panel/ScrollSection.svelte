<script lang="ts">
	import { planSetProps, type OverflowDirection } from '../../lib/document';
	import { applyEdit } from '../../lib/editing/contribute';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';

	const ctx = getKernel();

	const OPTIONS = [
		{ value: 'NONE', label: 'No scrolling' },
		{ value: 'HORIZONTAL_SCROLLING', label: 'Horizontal scrolling' },
		{ value: 'VERTICAL_SCROLLING', label: 'Vertical scrolling' },
		{ value: 'HORIZONTAL_AND_VERTICAL_SCROLLING', label: 'Both directions' }
	];

	const frame = $derived.by(() => {
		if (ctx.selection.ids.length !== 1) return undefined;
		const node = ctx.document.get(ctx.selection.ids[0]);
		if (node === undefined || node.type !== 'FRAME') return undefined;
		return node;
	});

	function change(value: string): void {
		if (frame === undefined) return;
		const changes = planSetProps(ctx.document.reader, frame.id, {
			overflowDirection: value as OverflowDirection
		});
		applyEdit(ctx, changes, 'Set overflow scrolling');
	}
</script>

{#if frame !== undefined}
	<div class="flex items-center gap-2 px-3 pb-3" data-scroll-section>
		<span class="text-faint w-16 shrink-0 text-xs">Overflow</span>
		<div class="min-w-0 flex-1" data-field="overflow">
			<DropdownField options={OPTIONS} value={frame.overflowDirection} onchange={change} />
		</div>
	</div>
{/if}
