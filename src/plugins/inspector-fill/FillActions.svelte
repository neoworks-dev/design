<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { planSetProps } from '../../lib/document';
	import { newPaint } from '../../lib/editing/paints';
	import { editSelection, selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import StyleButton from '../../lib/inspector-inputs/StyleButton.svelte';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	// Header controls of the Fill section: styles picker and "add fill".
	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	function addFill(): void {
		editSelection(
			ctx,
			{ label: 'Add fill', mergeKey: 'inspector:fill:Add fill', gesture: 'commit' },
			(reader, node) => {
				if (!('fills' in node)) return [];
				return planSetProps(reader, node.id, { fills: [...node.fills, newPaint('fill')] });
			}
		);
	}
</script>

<StyleButton target="fill" {nodes} />
<IconToggleButton icon={PlusIcon} label="Add fill" onclick={addFill} />
