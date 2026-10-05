<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { planSetProps } from '../../lib/document';
	import { newPaint } from '../../lib/editing/paints';
	import { changeStrokePaints } from '../../lib/editing/strokes';
	import { editSelection, selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import StyleButton from '../../lib/inspector-inputs/StyleButton.svelte';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	// Header controls of the Stroke section: styles picker and "add stroke".
	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	function addStroke(): void {
		editSelection(
			ctx,
			{ label: 'Add stroke', mergeKey: 'inspector:stroke:Add stroke', gesture: 'commit' },
			(reader, node) => {
				if (!('strokes' in node)) return [];
				const strokes = changeStrokePaints(node.strokes, (paints) => [
					...paints,
					newPaint('stroke')
				]);
				return planSetProps(reader, node.id, { strokes });
			}
		);
	}
</script>

<StyleButton target="stroke" {nodes} />
<IconToggleButton icon={PlusIcon} label="Add stroke" onclick={addStroke} />
