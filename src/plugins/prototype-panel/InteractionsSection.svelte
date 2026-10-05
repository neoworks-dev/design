<script lang="ts">
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import { getKernel } from '../../lib/kernel/context';
	import {
		ACTION_LABELS,
		actionKind,
		destinationOfReaction,
		primaryAction,
		TRIGGER_LABELS,
		triggerKind
	} from '../../lib/prototype/model';
	import type { Reaction } from '../../lib/document';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import InteractionEditor from './InteractionEditor.svelte';

	const ctx = getKernel();

	const nodeId = $derived.by(() => {
		if (ctx.selection.ids.length !== 1) return undefined;
		return ctx.selection.ids[0];
	});
	const reactions = $derived.by(() => {
		if (nodeId === undefined) return [];
		return ctx.prototyping.reactions(nodeId);
	});
	const active = $derived(ctx.prototyping.state.activeInteraction);

	function destinationName(reaction: Reaction): string {
		const destinationId = destinationOfReaction(reaction);
		if (destinationId === null) return '';
		const destination = ctx.document.get(destinationId);
		if (destination === undefined) return 'Missing frame';
		return destination.name;
	}

	function summary(reaction: Reaction): string {
		const kind = actionKind(primaryAction(reaction));
		return `${ACTION_LABELS[kind]} ${destinationName(reaction)}`.trim();
	}

	function isActive(index: number): boolean {
		return active !== null && active.nodeId === nodeId && active.index === index;
	}

	function toggle(index: number): void {
		if (nodeId === undefined) return;
		if (isActive(index)) {
			ctx.prototyping.selectConnection(null);
			return;
		}
		ctx.prototyping.selectConnection({ nodeId, index });
	}

	function remove(index: number): void {
		if (nodeId === undefined) return;
		ctx.prototyping.removeInteraction(nodeId, index);
	}
</script>

<div class="flex flex-col gap-1 px-3 pb-3" data-interactions-section>
	{#if reactions.length === 0}
		<span class="text-faint text-xs">No interactions. Add one, or drag from the frame handle.</span>
	{/if}
	{#each reactions as reaction, index (index)}
		<div
			class={[
				'rounded-md border px-2 py-1.5',
				isActive(index) ? 'border-action' : 'border-line-faint'
			]}
			data-interaction-row={index}
		>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="hover:text-default text-muted flex min-w-0 flex-1 flex-col items-start text-left"
					aria-label="Interaction {index + 1}"
					aria-expanded={isActive(index)}
					onclick={() => toggle(index)}
				>
					<span class="text-default text-xs">{TRIGGER_LABELS[triggerKind(reaction.trigger)]}</span>
					<span class="text-muted flex max-w-full items-center gap-1 truncate text-xs">
						<ArrowRightIcon size={10} />
						{summary(reaction)}
					</span>
				</button>
				<IconToggleButton
					icon={MinusIcon}
					label="Remove interaction {index + 1}"
					onclick={() => remove(index)}
				/>
			</div>
			{#if isActive(index) && nodeId !== undefined}
				<InteractionEditor {nodeId} {index} {reaction} />
			{/if}
		</div>
	{/each}
</div>
