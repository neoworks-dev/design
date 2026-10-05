<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import type { ComponentEntry } from '../../lib/services/assetsPanel';
	import StylePreview from '../../lib/inspector-inputs/StylePreview.svelte';
	import { getKernel } from '../../lib/kernel/context';
	import { leafNameOf } from '../../lib/variables/organize';

	const ctx = getKernel();
	const panel = ctx.assetsPanel;

	const DRAG_THRESHOLD = 4;

	const groups = $derived(panel.componentGroups());
	const styleSections = $derived(panel.styleSections());
	const media = $derived(panel.media());
	const searching = $derived(panel.query.trim() !== '');

	let drag = $state<{ entry: ComponentEntry; x: number; y: number } | null>(null);

	function expanded(key: string): boolean {
		if (searching) return true;
		return !panel.isCollapsed(key);
	}

	// ---------- drag a component onto the canvas ----------
	// Pointer events rather than HTML5 drag and drop: the same code serves real mice and the QA
	// driver, and the ghost can show the swap hint. The window listeners live in `ctx.effect`.

	function pointerdown(event: PointerEvent, entry: ComponentEntry): void {
		if (event.button !== 0) return;
		const start = { x: event.clientX, y: event.clientY };
		let dragging = false;
		let release: () => void = () => undefined;
		const finish = (): void => {
			drag = null;
			release();
		};
		const move = (moveEvent: PointerEvent): void => {
			if (
				!dragging &&
				Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > DRAG_THRESHOLD
			) {
				dragging = true;
			}
			if (dragging) drag = { entry, x: moveEvent.clientX, y: moveEvent.clientY };
		};
		const up = (upEvent: PointerEvent): void => {
			const wasDragging = dragging;
			finish();
			if (wasDragging) dropOnCanvas(entry, upEvent);
		};
		const cancel = (keyEvent: KeyboardEvent): void => {
			if (keyEvent.key === 'Escape') finish();
		};
		release = ctx.effect(() => {
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', up);
			window.addEventListener('keydown', cancel, true);
			return () => {
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', up);
				window.removeEventListener('keydown', cancel, true);
			};
		}, 'assets drag');
	}

	function dropOnCanvas(entry: ComponentEntry, event: PointerEvent): void {
		const target = document.elementFromPoint(event.clientX, event.clientY);
		const host = target?.closest('[data-canvas-host]');
		const canvas = host?.querySelector('canvas');
		if (canvas === null || canvas === undefined) return;
		const box = canvas.getBoundingClientRect();
		const world = ctx.viewport.screenToWorld({
			x: event.clientX - box.left,
			y: event.clientY - box.top
		});
		const hit = ctx.hitTest.deepest({ point: world });
		panel.insertAt(entry.id, world, hit);
	}

	function insertOnEnter(event: KeyboardEvent, entry: ComponentEntry): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		panel.insertAtDefault(entry.id);
	}

	function renameStyle(styleId: string, name: string): void {
		const trimmed = name.trim();
		panel.startRenamingStyle(null);
		if (trimmed === '') return;
		ctx.styles.rename(styleId, trimmed);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" data-assets-panel>
	<div class="border-line-faint flex items-center gap-2 border-b px-3 py-2">
		<MagnifyingGlassIcon size={14} class="text-muted shrink-0" />
		<input
			class="bg-input border-line text-default h-7 min-w-0 flex-1 rounded border px-2 text-xs"
			placeholder="Search assets"
			aria-label="Search assets"
			value={panel.query}
			oninput={(event) => panel.setQuery(event.currentTarget.value)}
		/>
	</div>

	{#if panel.notice !== ''}
		<p class="bg-red-soft text-red px-3 py-1 text-xs" role="alert" data-assets-notice>
			{panel.notice}
		</p>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto pb-4 text-xs">
		<button
			type="button"
			class="text-default flex w-full items-center gap-1 px-3 py-2 font-medium"
			aria-expanded={expanded('components')}
			onclick={() => panel.toggleCollapsed('components')}
		>
			{#if expanded('components')}<CaretDownIcon size={10} />{:else}<CaretRightIcon
					size={10}
				/>{/if}
			Components
		</button>
		{#if expanded('components')}
			{#each groups as group (group.group)}
				{#if group.group !== ''}
					<div class="text-faint px-3 pt-1 pb-0.5" data-asset-group={group.group}>
						{group.group}
					</div>
				{/if}
				{#each group.entries as entry (entry.id)}
					<button
						type="button"
						class={[
							'hover:bg-hover flex w-full items-center gap-2 px-4 py-1 text-left select-none',
							entry.blocked && 'opacity-40'
						]}
						title={entry.blocked
							? 'Cannot be inserted into itself'
							: entry.description || entry.name}
						data-asset-component={entry.id}
						onpointerdown={(event) => pointerdown(event, entry)}
						ondblclick={() => panel.insertAtDefault(entry.id)}
						onkeydown={(event) => insertOnEnter(event, entry)}
						oncontextmenu={(event) =>
							ctx.menus.openFromEvent('asset-component', event, { id: entry.id })}
					>
						<DiamondIcon size={12} weight="fill" class="text-accent shrink-0" />
						<span class="truncate">{entry.label}</span>
					</button>
				{/each}
			{:else}
				<p class="text-faint px-4 py-1">
					{searching ? 'No matching components' : 'No components yet'}
				</p>
			{/each}
		{/if}

		{#each styleSections as section (section.type)}
			<button
				type="button"
				class="text-default flex w-full items-center gap-1 px-3 py-2 font-medium"
				aria-expanded={expanded(section.type)}
				onclick={() => panel.toggleCollapsed(section.type)}
			>
				{#if expanded(section.type)}<CaretDownIcon size={10} />{:else}<CaretRightIcon
						size={10}
					/>{/if}
				{section.title}
			</button>
			{#if expanded(section.type)}
				{#each section.styles as style (style.id)}
					<div
						class="hover:bg-hover flex items-center gap-2 px-4 py-1"
						data-asset-style={style.id}
						role="presentation"
						oncontextmenu={(event) =>
							ctx.menus.openFromEvent(
								style.type === 'PAINT' ? 'asset-paint-style' : 'asset-style',
								event,
								{ id: style.id }
							)}
					>
						<StylePreview {style} />
						{#if panel.renamingStyleId === style.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="bg-input border-line text-default h-6 min-w-0 flex-1 rounded border px-1"
								aria-label="Style name"
								value={style.name}
								autofocus
								onblur={(event) => renameStyle(style.id, event.currentTarget.value)}
								onkeydown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur();
									if (event.key === 'Escape') panel.startRenamingStyle(null);
								}}
							/>
						{:else}
							<button
								type="button"
								class="min-w-0 flex-1 truncate text-left"
								title={style.name}
								onclick={() => panel.applyStyle(style.id)}
							>
								{leafNameOf(style.name)}
								{#if style.name.includes('/')}
									<span class="text-faint"
										>· {style.name.slice(0, style.name.lastIndexOf('/'))}</span
									>
								{/if}
							</button>
						{/if}
					</div>
				{/each}
			{/if}
		{/each}

		{#if media.length > 0 && !searching}
			<button
				type="button"
				class="text-default flex w-full items-center gap-1 px-3 py-2 font-medium"
				aria-expanded={expanded('media')}
				onclick={() => panel.toggleCollapsed('media')}
			>
				{#if expanded('media')}<CaretDownIcon size={10} />{:else}<CaretRightIcon size={10} />{/if}
				Media
			</button>
			{#if expanded('media')}
				{#each media as asset (asset.id)}
					<div class="text-muted flex items-center gap-2 px-4 py-1" data-asset-media={asset.id}>
						<ImageIcon size={12} />
						<span class="truncate">
							{asset.mime.replace('image/', '').toUpperCase()}
							{#if asset.width !== undefined && asset.height !== undefined}
								{asset.width} × {asset.height}
							{/if}
						</span>
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>

{#if drag !== null}
	<div
		class="bg-elevated border-line text-default pointer-events-none fixed z-50 flex items-center gap-2 rounded border px-2 py-1 text-xs shadow-lg"
		style:left="{drag.x + 12}px"
		style:top="{drag.y + 12}px"
		data-asset-ghost
	>
		<DiamondIcon size={12} weight="fill" class="text-accent" />
		{drag.entry.label}
	</div>
{/if}
