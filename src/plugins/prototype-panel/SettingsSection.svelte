<script lang="ts">
	import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { DEVICE_PRESETS } from '../../lib/prototype/model';
	import DropdownField from '../../lib/ui/DropdownField.svelte';

	const ctx = getKernel();

	const options = DEVICE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }));
	const settings = $derived(ctx.prototyping.settings());
</script>

<div class="flex flex-col gap-2 px-3 pb-3" data-prototype-settings>
	<div class="flex items-center gap-2">
		<span class="text-faint w-16 shrink-0 text-xs">Device</span>
		<div class="min-w-0 flex-1" data-field="device">
			<DropdownField
				{options}
				value={settings.device}
				onchange={(device) => ctx.prototyping.setDevice(device)}
			/>
		</div>
	</div>
	<button
		type="button"
		class="bg-raised hover:bg-hover text-default border-line flex h-7 items-center justify-center gap-1 rounded-md border text-xs"
		aria-label="Preview prototype"
		onclick={() => void ctx.commands.run('presentation.preview')}
	>
		<PlayIcon size={12} weight="fill" /> Preview
	</button>
</div>
