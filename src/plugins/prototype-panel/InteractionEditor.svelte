<script lang="ts">
	import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import type { Action, NodeId, Reaction, Transition } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import {
		ACTION_LABELS,
		actionKind,
		actionOfKind,
		DIRECTIONAL_TRANSITIONS,
		EASING_LABELS,
		primaryAction,
		TRANSITION_LABELS,
		TRIGGER_LABELS,
		transitionKind,
		transitionOfKind,
		triggerKind,
		triggerOfKind,
		type ActionKind,
		type TransitionKind,
		type TriggerKind
	} from '../../lib/prototype/model';
	import { keyCodeLabel } from '../../lib/prototype/keys';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';

	let {
		nodeId,
		index,
		reaction
	}: {
		nodeId: NodeId;
		index: number;
		reaction: Reaction;
	} = $props();

	const ctx = getKernel();

	const MAX_SCROLL_TARGETS = 80;
	const TRIGGER_OPTIONS = Object.entries(TRIGGER_LABELS).map(([value, label]) => ({
		value,
		label
	}));
	const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));
	const TRANSITION_OPTIONS = Object.entries(TRANSITION_LABELS).map(([value, label]) => ({
		value,
		label
	}));
	const EASING_OPTIONS = Object.entries(EASING_LABELS).map(([value, label]) => ({ value, label }));
	const DIRECTION_OPTIONS = [
		{ value: 'LEFT', label: 'From left', icon: ArrowRightIcon },
		{ value: 'RIGHT', label: 'From right', icon: ArrowLeftIcon },
		{ value: 'TOP', label: 'From top', icon: ArrowDownIcon },
		{ value: 'BOTTOM', label: 'From bottom', icon: ArrowUpIcon }
	];

	const trigger = $derived(reaction.trigger);
	const action = $derived(primaryAction(reaction));
	const kind = $derived(actionKind(action));
	const hasDestination = $derived(
		kind === 'NAVIGATE' || kind === 'OVERLAY' || kind === 'SWAP' || kind === 'SCROLL_TO'
	);
	const hasTransition = $derived(kind === 'NAVIGATE' || kind === 'OVERLAY' || kind === 'SWAP');
	const nodeAction = $derived.by(() => {
		if (action === undefined || action.type !== 'NODE') return undefined;
		return action;
	});
	const destinationValue = $derived.by(() => {
		if (nodeAction === undefined || nodeAction.destinationId === null) return '';
		return nodeAction.destinationId;
	});
	const transition = $derived(nodeAction?.transition);
	const currentTransitionKind = $derived(transitionKind(transition));
	const directional = $derived(DIRECTIONAL_TRANSITIONS.includes(currentTransitionKind));
	let capturingKey = $state(false);

	const destinationOptions = $derived.by(() => {
		const options = [{ value: '', label: 'Select a frame' }];
		if (kind !== 'SCROLL_TO') {
			for (const screen of ctx.prototyping.screens()) {
				options.push({ value: screen.id, label: screen.name });
			}
			return options;
		}
		const screenId = ctx.prototyping.screenOf(nodeId);
		if (screenId === undefined) return options;
		const targets = ctx.document.descendants(screenId).filter((node) => node.id !== nodeId);
		for (const target of targets.slice(0, MAX_SCROLL_TARGETS)) {
			options.push({ value: target.id, label: target.name });
		}
		return options;
	});

	function save(next: Reaction): void {
		ctx.prototyping.updateInteraction(nodeId, index, next);
	}

	function withAction(next: Action): Reaction {
		return { ...reaction, actions: [next, ...reaction.actions.slice(1)] };
	}

	function withNodeAction(change: (current: NonNullable<typeof nodeAction>) => Action): void {
		if (nodeAction === undefined) return;
		save(withAction(change(nodeAction)));
	}

	function changeTrigger(value: string): void {
		save({ ...reaction, trigger: triggerOfKind(value as TriggerKind, trigger) });
	}

	function changeAction(value: string): void {
		save(withAction(actionOfKind(value as ActionKind, action)));
	}

	function changeDestination(value: string): void {
		let destinationId: NodeId | null = null;
		if (value !== '') destinationId = value;
		withNodeAction((current) => ({ ...current, destinationId }));
	}

	function changeTransition(next: Transition | undefined): void {
		withNodeAction((current) => ({ ...current, transition: next }));
	}

	function changeTransitionKind(value: string): void {
		changeTransition(transitionOfKind(value as TransitionKind, transition));
	}

	function changeDirection(value: string): void {
		if (transition === undefined) return;
		changeTransition({ ...transition, direction: value as Transition['direction'] });
	}

	function changeEasing(value: string): void {
		if (transition === undefined) return;
		changeTransition({ ...transition, easing: { type: value } });
	}

	function changeDuration(milliseconds: number): void {
		if (transition === undefined) return;
		changeTransition({ ...transition, duration: milliseconds / 1000 });
	}

	function changeTimeout(milliseconds: number): void {
		if (trigger === null || trigger.type !== 'AFTER_TIMEOUT') return;
		save({ ...reaction, trigger: { ...trigger, timeout: milliseconds / 1000 } });
	}

	function captureKey(event: KeyboardEvent): void {
		event.preventDefault();
		event.stopPropagation();
		capturingKey = false;
		if (event.key === 'Escape') return;
		if (trigger === null || trigger.type !== 'ON_KEY_DOWN') return;
		save({ ...reaction, trigger: { ...trigger, keyCodes: [event.keyCode] } });
	}

	function changeUrl(url: string): void {
		if (action === undefined || action.type !== 'URL') return;
		save(withAction({ ...action, url }));
	}

	function changeOpenInNewTab(openInNewTab: boolean): void {
		if (action === undefined || action.type !== 'URL') return;
		save(withAction({ ...action, openInNewTab }));
	}

	function milliseconds(seconds: number): number {
		return Math.round(seconds * 1000);
	}
</script>

<div class="border-line-faint flex flex-col gap-2 border-t pt-2" data-interaction-editor={index}>
	<div class="flex items-center gap-2">
		<span class="text-faint w-16 shrink-0 text-xs">Trigger</span>
		<div class="min-w-0 flex-1" data-field="trigger">
			<DropdownField
				options={TRIGGER_OPTIONS}
				value={triggerKind(trigger)}
				onchange={changeTrigger}
			/>
		</div>
	</div>
	{#if trigger !== null && trigger.type === 'AFTER_TIMEOUT'}
		<div class="flex items-center gap-2">
			<span class="text-faint w-16 shrink-0 text-xs">Delay</span>
			<div class="min-w-0 flex-1">
				<NumberField
					label="T"
					name="Trigger delay"
					unit="ms"
					min={0}
					step={100}
					precision={0}
					value={milliseconds(trigger.timeout)}
					onchange={(value) => changeTimeout(value)}
				/>
			</div>
		</div>
	{/if}
	{#if trigger !== null && trigger.type === 'ON_KEY_DOWN'}
		<div class="flex items-center gap-2">
			<span class="text-faint w-16 shrink-0 text-xs">Key</span>
			<button
				type="button"
				class="bg-input border-line hover:border-line-strong text-default h-7 min-w-0 flex-1 rounded-md border px-2 text-left text-xs"
				aria-label="Trigger key"
				onclick={() => (capturingKey = true)}
				onkeydown={(event) => {
					if (capturingKey) captureKey(event);
				}}
				onblur={() => (capturingKey = false)}
			>
				{#if capturingKey}
					Press a key
				{:else}
					{trigger.keyCodes.map(keyCodeLabel).join(' + ')}
				{/if}
			</button>
		</div>
	{/if}

	<div class="flex items-center gap-2">
		<span class="text-faint w-16 shrink-0 text-xs">Action</span>
		<div class="min-w-0 flex-1" data-field="action">
			<DropdownField options={ACTION_OPTIONS} value={kind} onchange={changeAction} />
		</div>
	</div>
	{#if hasDestination}
		<div class="flex items-center gap-2">
			<span class="text-faint w-16 shrink-0 text-xs">
				{#if kind === 'SCROLL_TO'}Layer{:else}Frame{/if}
			</span>
			<div class="min-w-0 flex-1" data-field="destination">
				<DropdownField
					options={destinationOptions}
					value={destinationValue}
					placeholder="Select a frame"
					onchange={changeDestination}
				/>
			</div>
		</div>
	{/if}
	{#if kind === 'URL' && action !== undefined && action.type === 'URL'}
		<div class="flex items-center gap-2">
			<span class="text-faint w-16 shrink-0 text-xs">URL</span>
			<input
				type="text"
				aria-label="Link URL"
				class="bg-input border-line hover:border-line-strong focus:border-action text-default h-7 min-w-0 flex-1 rounded-md border px-2 text-xs outline-none"
				value={action.url}
				onchange={(event) => changeUrl(event.currentTarget.value)}
			/>
		</div>
		<label class="text-muted flex items-center gap-2 pl-[4.5rem] text-xs">
			<input
				type="checkbox"
				checked={action.openInNewTab === true}
				onchange={(event) => changeOpenInNewTab(event.currentTarget.checked)}
			/>
			Open in new tab
		</label>
	{/if}

	{#if hasTransition}
		<div class="flex items-center gap-2">
			<span class="text-faint w-16 shrink-0 text-xs">Animation</span>
			<div class="min-w-0 flex-1" data-field="animation">
				<DropdownField
					options={TRANSITION_OPTIONS}
					value={currentTransitionKind}
					onchange={changeTransitionKind}
				/>
			</div>
		</div>
		{#if transition !== undefined}
			{#if directional}
				<div class="flex items-center gap-2">
					<span class="text-faint w-16 shrink-0 text-xs">Direction</span>
					<ToggleGroup
						name="Animation direction"
						options={DIRECTION_OPTIONS}
						value={transition.direction ?? 'LEFT'}
						onchange={changeDirection}
					/>
				</div>
			{/if}
			<div class="flex items-center gap-2">
				<span class="text-faint w-16 shrink-0 text-xs">Easing</span>
				<div class="min-w-0 flex-1" data-field="easing">
					<DropdownField
						options={EASING_OPTIONS}
						value={transition.easing.type}
						onchange={changeEasing}
					/>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-faint w-16 shrink-0 text-xs">Duration</span>
				<div class="min-w-0 flex-1">
					<NumberField
						label="D"
						name="Animation duration"
						unit="ms"
						min={0}
						step={50}
						precision={0}
						value={milliseconds(transition.duration)}
						onchange={(value) => changeDuration(value)}
					/>
				</div>
			</div>
		{/if}
	{/if}
</div>
