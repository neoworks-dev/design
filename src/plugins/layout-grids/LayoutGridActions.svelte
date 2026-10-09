<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { selectedNodes, setSelectionProps } from '../../lib/inspector-inputs/selectionEdit';
	import StyleButton from '../../lib/inspector-inputs/StyleButton.svelte';
	import { getKernel } from '../../lib/kernel/context';
	import { defaultGrid } from '../../lib/layout-grids/grids';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	// Header controls of the Layout guide section: styles picker and "add layout grid".
	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	function add(): void {
		setSelectionProps(
			ctx,
			{
				label: 'Add layout grid',
				mergeKey: 'inspector:layout-grid:Add layout grid',
				gesture: 'commit'
			},
			(node) => {
				if (!('layoutGrids' in node)) return {};
				return { layoutGrids: [...node.layoutGrids, defaultGrid('COLUMNS')] };
			}
		);
	}
</script>

<StyleButton target="grid" {nodes} />
<IconToggleButton icon={PlusIcon} label="Add layout grid" onclick={add} />
