<script lang="ts">
	import { Select } from '@neoworks-dev/ui';
	import {
		selectedMirroring,
		selectedRadius,
		setMirroringOnSelection,
		setRadiusOnSelection
	} from '../../lib/vector/editAdvanced';
	import type { VectorEditor } from '../../lib/vector/editTool';
	import type { HandleMirroring } from '../../lib/vector/handles';

	let { editor }: { editor: VectorEditor } = $props();

	const MODES = [
		{ value: 'NONE', label: 'No mirroring' },
		{ value: 'ANGLE', label: 'Mirror angle' },
		{ value: 'ANGLE_AND_LENGTH', label: 'Mirror angle and length' }
	];

	const mirroring = $derived.by(() => {
		void editor.state.revision.value;
		return selectedMirroring(editor);
	});
	const options = $derived(
		mirroring === null ? [...MODES, { value: 'MIXED', label: 'Mixed' }] : MODES
	);
	const radius = $derived.by(() => {
		void editor.state.revision.value;
		return selectedRadius(editor);
	});

	function chooseMirroring(value: string | string[]): void {
		if (typeof value !== 'string' || value === 'MIXED') return;
		setMirroringOnSelection(editor, value as HandleMirroring);
	}

	function changeRadius(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		setRadiusOnSelection(editor, event.currentTarget.valueAsNumber);
	}
</script>

<div class="flex flex-col gap-2 px-3 pb-3" data-vertex-section>
	<label class="text-muted flex items-center justify-between gap-3 text-xs">
		<span>Handles</span>
		<div class="w-44">
			<Select
				size="sm"
				value={mirroring === null ? 'MIXED' : mirroring}
				onChange={chooseMirroring}
				{options}
			/>
		</div>
	</label>
	<label class="text-muted flex items-center justify-between gap-3 text-xs">
		<span>Corner radius</span>
		<input
			class="bg-raised border-line text-default h-7 w-44 rounded-md border px-2 text-xs"
			type="number"
			min="0"
			step="1"
			placeholder={radius === null ? 'Mixed' : undefined}
			value={radius === null ? '' : radius}
			onchange={changeRadius}
			data-vertex-radius
		/>
	</label>
</div>
