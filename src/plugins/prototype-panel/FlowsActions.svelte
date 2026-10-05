<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	const ctx = getKernel();

	// The top-level frame holding the selection, when it is not a flow start yet.
	const candidate = $derived.by(() => {
		if (ctx.selection.ids.length !== 1) return undefined;
		const screenId = ctx.prototyping.screenOf(ctx.selection.ids[0]);
		if (screenId === undefined) return undefined;
		if (ctx.prototyping.flows().some((flow) => flow.nodeId === screenId)) return undefined;
		return screenId;
	});

	const title = $derived.by(() => {
		if (candidate === undefined) return 'Select a top-level frame that is not a starting point yet';
		return 'Add flow starting point';
	});

	function add(): void {
		if (candidate === undefined) return;
		ctx.prototyping.addFlow(candidate);
	}
</script>

<IconToggleButton
	icon={PlusIcon}
	label="Add flow starting point"
	disabled={candidate === undefined}
	{title}
	onclick={add}
/>
