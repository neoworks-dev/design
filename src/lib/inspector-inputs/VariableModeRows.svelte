<script lang="ts">
	import type { VariableCollection } from '../document';
	import { getKernel } from '../kernel/context';
	import DropdownField from '../ui/DropdownField.svelte';

	// One row per variable collection with more than one mode: the explicit mode of a frame,
	// section or page, or "Auto" which shows the mode inherited from the parent.
	let { nodeId }: { nodeId: string } = $props();

	const AUTO = 'auto';

	const ctx = getKernel();

	const collections = $derived(
		ctx.variables.collections().filter((entry) => entry.modes.length > 1)
	);
	const node = $derived(ctx.document.require(nodeId));

	function explicitModeOf(collection: VariableCollection): string {
		const explicit: unknown = Reflect.get(node, 'explicitVariableModes');
		if (typeof explicit !== 'object' || explicit === null) return AUTO;
		const modeId: unknown = Reflect.get(explicit, collection.id);
		if (typeof modeId !== 'string') return AUTO;
		return modeId;
	}

	function inheritedModeName(collection: VariableCollection): string {
		let modeId: string | undefined = collection.defaultModeId;
		if (node.parentId !== null) modeId = ctx.variables.modeFor(collection.id, node.parentId);
		const mode = collection.modes.find((entry) => entry.modeId === modeId);
		if (mode === undefined) return '';
		return mode.name;
	}

	function optionsOf(collection: VariableCollection): Array<{ value: string; label: string }> {
		const auto = { value: AUTO, label: `Auto (${inheritedModeName(collection)})` };
		return [auto, ...collection.modes.map((mode) => ({ value: mode.modeId, label: mode.name }))];
	}

	function choose(collection: VariableCollection, modeId: string): void {
		let target: string | null = modeId;
		if (modeId === AUTO) target = null;
		ctx.variables.setExplicitMode(nodeId, collection.id, target);
	}
</script>

{#each collections as collection (collection.id)}
	<div class="grid grid-cols-[72px_1fr] items-center gap-2 text-xs" data-mode-row={collection.id}>
		<span class="text-muted truncate" title={collection.name}>{collection.name}</span>
		<DropdownField
			options={optionsOf(collection)}
			value={explicitModeOf(collection)}
			onchange={(modeId) => choose(collection, modeId)}
		/>
	</div>
{/each}
