<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { planSetProps } from '../../lib/document';
	import { newEffect } from '../../lib/editing/effects';
	import { editSelection, selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import StyleButton from '../../lib/inspector-inputs/StyleButton.svelte';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	// Header controls of the Effects section: styles picker and "add effect".
	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	function addEffect(): void {
		editSelection(
			ctx,
			{ label: 'Add effect', mergeKey: 'inspector:effects:Add effect', gesture: 'commit' },
			(reader, node) => {
				if (!('effects' in node)) return [];
				return planSetProps(reader, node.id, {
					effects: [...node.effects, newEffect('DROP_SHADOW')]
				});
			}
		);
	}
</script>

<StyleButton target="effect" {nodes} />
<IconToggleButton icon={PlusIcon} label="Add effect" onclick={addEffect} />
