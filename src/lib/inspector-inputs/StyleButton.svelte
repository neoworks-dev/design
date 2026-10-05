<script lang="ts">
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import { STYLE_TARGETS, type Node, type Style, type StyleTarget } from '../document';
	import { getKernel } from '../kernel/context';
	import Popover from '../ui/Popover.svelte';
	import { groupByPath, leafNameOf, uniqueName } from '../variables/organize';
	import StylePreview from './StylePreview.svelte';

	// The "four dots" button of a design section: opens the picker of the styles that fit the
	// section (paint for fills and strokes, text, effect, layout grid). Click a style to apply it,
	// "+" creates one from the current values, redefine makes the applied style say what the
	// selection shows now, detach keeps the values and drops the link. Needs plugin `styles`.
	let { target, nodes }: { target: StyleTarget; nodes: readonly Node[] } = $props();

	const ctx = getKernel();
	const info = $derived(STYLE_TARGETS[target]);

	let anchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);
	let creating = $state(false);
	let draftName = $state('');
	let error = $state('');

	const nodeIds = $derived(nodes.map((node) => node.id));
	const appliedId = $derived(ctx.styles.sharedStyleId(nodeIds, target));
	const available = $derived(ctx.styles.list(info.type));
	// Grouped by slash path like variables; `name` is the full path of a style.
	const groups = $derived(groupByPath(available));

	function open(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const rect = event.currentTarget.getBoundingClientRect();
		anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		creating = false;
		error = '';
	}

	function close(): void {
		anchor = null;
	}

	function attempt(edit: () => void): boolean {
		try {
			edit();
			error = '';
			return true;
		} catch (failure) {
			if (failure instanceof Error) error = failure.message;
			else error = String(failure);
			return false;
		}
	}

	function startCreating(): void {
		draftName = uniqueName(
			`${info.label} style`,
			available.map((style) => style.name)
		);
		creating = true;
	}

	function create(): void {
		const name = draftName.trim();
		if (name === '') return;
		if (attempt(() => ctx.styles.create(target, nodeIds, name))) close();
	}

	function applyStyle(style: Style): void {
		if (attempt(() => ctx.styles.apply(target, style.id, nodeIds))) close();
	}

	function redefine(style: Style): void {
		attempt(() => ctx.styles.redefine(style.id, target, nodeIds[0]));
	}

	function detach(): void {
		if (attempt(() => ctx.styles.detach(target, nodeIds))) close();
	}
</script>

<button
	type="button"
	aria-label="{info.label} styles"
	title="{info.label} styles"
	aria-pressed={appliedId !== null}
	data-style-button={target}
	class={[
		'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
		appliedId === null && 'text-muted hover:bg-hover hover:text-default',
		appliedId !== null && 'bg-raised text-default'
	]}
	onclick={open}
>
	<SquaresFourIcon size={14} />
</button>

{#if anchor !== null}
	<Popover {anchor} label="{info.label} styles" width={240} onclose={close}>
		<div class="flex flex-col gap-1 p-2 text-xs" data-style-picker={target}>
			<div class="flex items-center justify-between px-1">
				<span class="text-muted">{info.label} styles</span>
				<button
					type="button"
					class="text-muted hover:text-default"
					aria-label="Create {info.label.toLowerCase()} style"
					data-create-style
					onclick={startCreating}
				>
					<PlusIcon size={14} />
				</button>
			</div>

			{#if creating}
				<form
					class="flex gap-1"
					onsubmit={(event) => {
						event.preventDefault();
						create();
					}}
				>
					<input
						class="bg-input border-line text-default h-7 min-w-0 flex-1 rounded border px-2"
						aria-label="Style name"
						placeholder="Style name"
						bind:value={draftName}
					/>
					<button
						type="submit"
						class="bg-raised hover:bg-hover rounded px-2"
						data-confirm-create-style
					>
						Create
					</button>
				</form>
			{/if}

			<ul class="flex max-h-64 flex-col overflow-y-auto">
				{#each groups as group (group.path)}
					{#if group.path !== ''}
						<li class="text-faint px-2 pt-2 pb-1">{group.path}</li>
					{/if}
					{#each group.items as style (style.id)}
						<li class="group/row flex items-center">
							<button
								type="button"
								class={[
									'hover:bg-hover flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left',
									style.id === appliedId && 'bg-raised'
								]}
								data-style-option={style.id}
								onclick={() => applyStyle(style)}
							>
								<StylePreview {style} />
								<span class="truncate">{leafNameOf(style.name)}</span>
							</button>
							<button
								type="button"
								class="text-muted hover:text-default px-1"
								aria-label="Redefine {style.name} from selection"
								title="Redefine from selection"
								data-redefine-style={style.id}
								onclick={() => redefine(style)}
							>
								<ArrowsClockwiseIcon size={12} />
							</button>
						</li>
					{/each}
				{:else}
					<li class="text-faint px-2 py-1">No {info.label.toLowerCase()} styles yet</li>
				{/each}
			</ul>

			{#if appliedId !== null}
				<button
					type="button"
					class="text-muted hover:text-default hover:bg-hover rounded px-2 py-1 text-left"
					data-detach-style
					onclick={detach}
				>
					Detach style
				</button>
			{/if}
			{#if error !== ''}
				<p class="text-red px-2" role="alert">{error}</p>
			{/if}
		</div>
	</Popover>
{/if}
