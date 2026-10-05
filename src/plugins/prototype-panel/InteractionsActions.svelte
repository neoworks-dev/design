<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	const ctx = getKernel();
	const nodeId = $derived.by(() => {
		if (ctx.selection.ids.length !== 1) return undefined;
		return ctx.selection.ids[0];
	});

	function add(): void {
		if (nodeId === undefined) return;
		ctx.prototyping.addInteraction(nodeId);
	}
</script>

<IconToggleButton
	icon={PlusIcon}
	label="Add interaction"
	disabled={nodeId === undefined}
	onclick={add}
/>
