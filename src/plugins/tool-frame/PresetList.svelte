<script lang="ts">
	import { ListRow } from '@neoworks-dev/ui';
	import { getKernel } from '../../lib/kernel/context';
	import { chooseFramePreset, type FramePresetState } from './framePresets.svelte';
	import { FRAME_PRESET_GROUPS } from './presets';

	let { presetState }: { presetState: FramePresetState } = $props();

	const ctx = getKernel();
</script>

<div class="flex flex-col pb-2" data-frame-presets>
	{#each FRAME_PRESET_GROUPS as group (group.id)}
		<p class="text-faint px-3 pt-2 pb-1 text-xs">{group.title}</p>
		{#each group.presets as preset (preset.id)}
			<div class:bg-raised={presetState.armed?.id === preset.id}>
				<ListRow
					title={preset.name}
					subtitle="{preset.width} × {preset.height}"
					onclick={() => chooseFramePreset(ctx, presetState, preset)}
				/>
			</div>
		{/each}
	{/each}
</div>
