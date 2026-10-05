<script lang="ts">
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { DEVICE_PRESETS, type ScaleMode } from '../../lib/prototype/model';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';

	const ctx = getKernel();

	const SCALE_OPTIONS = [
		{ value: 'fit', label: 'Fit' },
		{ value: 'fill', label: 'Fill width' },
		{ value: 'actual', label: '100%' }
	];
	const DEVICE_OPTIONS = DEVICE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }));

	const presentation = ctx.presentation;
	const session = $derived(presentation.session);
	const Player = ctx.prototypePlayer.view;
	const fullWindow = $derived(presentation.mode === 'present');

	let root = $state<HTMLElement>();

	// Present asks the platform for the whole screen; leaving fullscreen (F11, the browser's own
	// Escape) ends the presentation, so nothing is left half open.
	$effect(() => {
		if (!fullWindow || root === undefined) return;
		const element = root;
		return ctx.effect(() => {
			void element.requestFullscreen?.().catch(() => undefined);
			const onChange = (): void => {
				if (document.fullscreenElement === null) presentation.close();
			};
			document.addEventListener('fullscreenchange', onChange);
			return () => {
				document.removeEventListener('fullscreenchange', onChange);
				if (document.fullscreenElement !== null)
					void document.exitFullscreen().catch(() => undefined);
			};
		}, 'presentation fullscreen');
	});
</script>

{#if session !== null}
	<div
		bind:this={root}
		class={[
			'bg-canvas pointer-events-auto flex flex-col',
			fullWindow ? 'fixed inset-0 z-[100]' : 'absolute inset-0 z-[20]'
		]}
		data-presentation={presentation.mode}
	>
		<div
			class="border-line-faint bg-elevated flex h-10 shrink-0 items-center gap-2 border-b px-3"
			data-presentation-bar
		>
			<IconToggleButton
				icon={XIcon}
				label="Close presentation"
				title="Close (Esc)"
				onclick={() => presentation.close()}
			/>
			<span class="text-default min-w-0 flex-1 truncate text-xs font-semibold">
				{presentation.frameName(session.current)}
			</span>
			<div class="w-28" data-field="device">
				<DropdownField
					options={DEVICE_OPTIONS}
					value={presentation.deviceId}
					onchange={(device) => presentation.setDevice(device)}
				/>
			</div>
			<div class="w-28" data-field="scale">
				<DropdownField
					options={SCALE_OPTIONS}
					value={presentation.scaleMode}
					onchange={(mode) => presentation.setScaleMode(mode as ScaleMode)}
				/>
			</div>
			<IconToggleButton
				icon={CaretLeftIcon}
				label="Previous frame"
				title="Previous frame (Left)"
				onclick={() => presentation.previous()}
			/>
			<IconToggleButton
				icon={CaretRightIcon}
				label="Next frame"
				title="Next frame (Right)"
				onclick={() => presentation.next()}
			/>
			<IconToggleButton
				icon={ArrowClockwiseIcon}
				label="Restart"
				title="Restart (R)"
				onclick={() => presentation.restart()}
			/>
		</div>
		<div class="min-h-0 flex-1">
			{#key session}
				<Player {session} scaleMode={presentation.scaleMode} deviceId={presentation.deviceId} />
			{/key}
		</div>
	</div>
{/if}
