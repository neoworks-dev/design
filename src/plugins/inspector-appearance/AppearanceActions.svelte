<script lang="ts">
	import DropIcon from 'phosphor-svelte/lib/DropIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlashIcon';
	import { BLEND_MODES } from '../../lib/document';
	import { selectedNodes, setSelectionProps } from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import Popover from '../../lib/ui/Popover.svelte';
	import { blendLabel } from './corners';

	// Header controls of the Appearance section: visibility and the blend mode popover.
	const ctx = getKernel();
	const nodes = $derived(selectedNodes(ctx));

	const BLEND_OPTIONS = BLEND_MODES.map((mode) => ({ value: mode, label: blendLabel(mode) }));

	const visible = $derived(sharedValue(nodes, (node) => 'visible' in node && node.visible));
	const blend = $derived(
		sharedValue(nodes, (node) => ('blendMode' in node ? node.blendMode : null))
	);
	const customBlend = $derived(
		blend.mixed || (blend.value !== 'PASS_THROUGH' && blend.value !== 'NORMAL')
	);
	const blendTitle = $derived.by(() => {
		if (blend.mixed) return 'Blend mode: Mixed';
		if (blend.value === null) return 'Blend mode';
		return `Blend mode: ${blendLabel(blend.value)}`;
	});

	let anchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function openBlend(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		anchor = { x: box.x, y: box.y, width: box.width, height: box.height };
	}

	function setBlend(mode: string): void {
		setSelectionProps(
			ctx,
			{ label: 'Change blend mode', mergeKey: 'inspector:blend', gesture: 'commit' },
			(node) => {
				if (!('blendMode' in node)) return {};
				return { blendMode: mode };
			}
		);
	}
</script>

<IconToggleButton
	icon={visible.value === true ? EyeIcon : EyeSlashIcon}
	label="Visibility"
	title={visible.value === true ? 'Hide' : 'Show'}
	pressed={visible.value === false}
	onclick={() => void ctx.commands.run('node.toggle-visibility')}
/>
<IconToggleButton
	icon={DropIcon}
	label="Blend mode"
	title={blendTitle}
	pressed={customBlend}
	onclick={openBlend}
/>

{#if anchor !== null}
	<Popover {anchor} label="Blend mode" width={200} onclose={() => (anchor = null)}>
		<div class="p-2" data-blend-mode>
			<DropdownField
				options={BLEND_OPTIONS}
				value={blend.value}
				mixed={blend.mixed}
				onchange={setBlend}
			/>
		</div>
	</Popover>
{/if}
