<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
	import MaskHappyIcon from 'phosphor-svelte/lib/MaskHappyIcon';
	import PuzzlePieceIcon from 'phosphor-svelte/lib/PuzzlePieceIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import Popover from '../../lib/ui/Popover.svelte';

	const ctx = getKernel();

	const selected = $derived(ctx.selection.nodes());

	function typeLabel(type: string): string {
		const words = type.toLowerCase().replaceAll('_', ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	}

	// Figma names the selection by its type ("Frame"); the layer name lives in the layers panel
	// and in the menu behind the chevron.
	const title = $derived.by(() => {
		if (selected.length === 0) return ctx.document.currentPage.name;
		if (selected.length > 1) return `${selected.length} layers`;
		return typeLabel(selected[0].type);
	});

	const canMask = $derived(selected.length > 0 && selected.every((node) => 'isMask' in node));
	const masked = $derived(canMask && selected.every((node) => 'isMask' in node && node.isMask));

	const MENU_COMMANDS = [
		{ command: 'node.rename', label: 'Rename' },
		{ command: 'grouping.group', label: 'Group selection' },
		{ command: 'grouping.frame-selection', label: 'Frame selection' },
		{ command: 'grouping.ungroup', label: 'Ungroup' },
		{ command: 'node.toggle-lock', label: 'Lock / unlock' },
		{ command: 'components.detach', label: 'Detach instance' }
	];

	const menuItems = $derived(MENU_COMMANDS.filter((item) => ctx.commands.has(item.command)));
	const hasMenu = $derived(selected.length > 0 && menuItems.length > 0);
	const layerName = $derived.by(() => {
		if (selected.length !== 1) return '';
		return selected[0].name;
	});

	let anchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function openMenu(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		anchor = { x: box.x, y: box.y, width: box.width, height: box.height };
	}

	function run(command: string): void {
		anchor = null;
		void ctx.commands.run(command);
	}
</script>

<div class="border-line-faint flex h-12 items-center justify-between pr-3 pl-4" data-design-header>
	<div class="flex min-w-0 items-center" data-node-header>
		{#if hasMenu}
			<button
				type="button"
				aria-label="Layer options"
				title={layerName}
				class="text-default hover:bg-hover -ml-2 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold"
				onclick={openMenu}
			>
				<span class="truncate">{title}</span>
				<CaretDownIcon size={10} weight="bold" class="text-muted shrink-0" />
			</button>
		{:else}
			<span class="text-default truncate text-sm font-semibold">{title}</span>
		{/if}
	</div>
	<div class="flex shrink-0 items-center">
		<IconToggleButton
			icon={CodeIcon}
			label="Dev Mode"
			title="Dev Mode (Shift+D)"
			pressed={ctx.panels.mode === 'dev'}
			onclick={() => void ctx.commands.run('panels.toggle-dev-mode')}
		/>
		{#if selected.length > 0 && ctx.commands.has('components.create')}
			<IconToggleButton
				icon={PuzzlePieceIcon}
				label="Create component"
				onclick={() => void ctx.commands.run('components.create')}
			/>
		{/if}
		{#if canMask}
			<IconToggleButton
				icon={MaskHappyIcon}
				label="Use as mask"
				pressed={masked}
				onclick={() => void ctx.commands.run('mask.toggle')}
			/>
		{/if}
	</div>
</div>

{#if anchor !== null}
	<Popover {anchor} label="Layer options" width={200} onclose={() => (anchor = null)}>
		<div class="flex flex-col p-1 text-xs" role="menu" data-layer-menu>
			{#if layerName !== ''}
				<span class="text-muted truncate px-2 py-1">{layerName}</span>
			{/if}
			{#each menuItems as item (item.command)}
				<button
					type="button"
					role="menuitem"
					class="text-default hover:bg-hover rounded px-2 py-1 text-left"
					onclick={() => run(item.command)}
				>
					{item.label}
				</button>
			{/each}
		</div>
	</Popover>
{/if}
