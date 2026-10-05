<script lang="ts">
	import { planSetProps, type Node, type Paint } from '../../lib/document';
	import { editSelection, selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import PaintList from '../../lib/inspector-inputs/PaintList.svelte';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import type { NumberGesture } from '../../lib/ui/numberField';

	const NO_PAINTS: Paint[] = [];
	const ctx = getKernel();

	const nodes = $derived(selectedNodes(ctx));
	function fillsOf(node: Node): Paint[] {
		if (!('fills' in node)) return NO_PAINTS;
		return node.fills;
	}
	const fills = $derived(sharedValue(nodes, fillsOf));
	const shownFills = $derived.by(() => {
		if (fills.value === null) return [];
		return fills.value;
	});
	const stored = $derived.by(() => {
		const [first] = nodes;
		if (first === undefined) return [];
		const node = ctx.document.require(first.id);
		if (!('fills' in node)) return [];
		return node.fills;
	});

	function edit(update: (paints: Paint[]) => Paint[], gesture: NumberGesture, label: string): void {
		editSelection(ctx, { label, mergeKey: `inspector:fill:${label}`, gesture }, (reader, node) => {
			if (!('fills' in node)) return [];
			return planSetProps(reader, node.id, { fills: update(node.fills) });
		});
	}
</script>

{#if nodes.length > 0}
	<div data-fill-section>
		<PaintList
			role="fill"
			paints={shownFills}
			{stored}
			nodeId={nodes[0].id}
			mixed={fills.mixed}
			{nodes}
			onedit={edit}
		/>
	</div>
{/if}
