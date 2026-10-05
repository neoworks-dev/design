<script lang="ts">
	import { bindableTargets, bindLayer, typeOfTarget } from '../../lib/components/properties';
	import { definitionsOf, type ComponentPropertyTarget } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import CreatePropertyPopover from './CreatePropertyPopover.svelte';

	// The Design tab section of a layer inside a main component: bind its visibility, text or
	// nested instance to a component property, or create a property from it.
	const ctx = getKernel();

	const TARGET_LABELS: Record<ComponentPropertyTarget, string> = {
		visible: 'Visibility',
		characters: 'Text',
		mainComponent: 'Instance'
	};
	const NONE = '__none';

	const layer = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		return ctx.document.get(id);
	});
	const main = $derived(
		layer === undefined ? undefined : ctx.componentSync.enclosingMainOf(layer.id)
	);
	const targets = $derived.by(() => {
		if (layer === undefined || main === undefined || layer.id === main.id) return [];
		return bindableTargets(ctx, layer.id);
	});

	function optionsFor(target: ComponentPropertyTarget): { value: string; label: string }[] {
		if (main === undefined) return [];
		const options = [{ value: NONE, label: 'None' }];
		for (const [key, definition] of Object.entries(definitionsOf(ctx.document.reader, main.id))) {
			if (definition.type === typeOfTarget(target)) options.push({ value: key, label: key });
		}
		return options;
	}

	function current(target: ComponentPropertyTarget): string {
		const key = layer?.componentPropertyReferences?.[target];
		if (key === undefined) return NONE;
		return key;
	}

	function change(target: ComponentPropertyTarget, value: string): void {
		if (layer === undefined || main === undefined) return;
		let key: string | undefined = value;
		if (value === NONE) key = undefined;
		bindLayer(ctx, layer.id, target, main.id, key);
	}

	let creating = $state<{
		target: ComponentPropertyTarget;
		anchor: { x: number; y: number; width: number; height: number };
	} | null>(null);

	function openCreate(event: MouseEvent, target: ComponentPropertyTarget): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		creating = {
			target,
			anchor: { x: box.left, y: box.top, width: box.width, height: box.height }
		};
	}
</script>

{#if layer !== undefined && main !== undefined && targets.length > 0}
	<div class="flex flex-col gap-2 px-3 pb-3" data-layer-bindings>
		{#each targets as target (target)}
			<div class="flex items-center gap-2 text-xs" data-binding={target}>
				<span class="text-muted w-16 shrink-0">{TARGET_LABELS[target]}</span>
				<div class="min-w-0 flex-1">
					<DropdownField
						options={optionsFor(target)}
						value={current(target)}
						onchange={(value) => change(target, value)}
					/>
				</div>
				<button
					type="button"
					class="text-violet hover:bg-hover rounded-sm px-1 text-xs"
					aria-label="Create property for {TARGET_LABELS[target]}"
					onclick={(event) => openCreate(event, target)}
				>
					+
				</button>
			</div>
		{/each}
	</div>
{/if}

{#if creating !== null && layer !== undefined && main !== undefined}
	<CreatePropertyPopover
		anchor={creating.anchor}
		mainId={main.id}
		layerId={layer.id}
		target={creating.target}
		onclose={() => (creating = null)}
	/>
{/if}
