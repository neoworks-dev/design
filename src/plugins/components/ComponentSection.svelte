<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import DiamondsFourIcon from 'phosphor-svelte/lib/DiamondsFourIcon';
	import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
	import { createInstances } from '../../lib/components/actions';
	import { COMPONENT_NAMESPACE, readComponentSettings } from '../../lib/components/settings';
	import { applyEdit } from '../../lib/editing/contribute';
	import { getKernel } from '../../lib/kernel/context';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import Popover from '../../lib/ui/Popover.svelte';

	// The Design tab section of a selected main component: its name, a configuration popover
	// (description, documentation link, simplify instances) and a shortcut to make an instance.
	const ctx = getKernel();

	const component = $derived.by(() => {
		const id = ctx.selection.primaryId;
		if (id === null) return undefined;
		const node = ctx.document.get(id);
		if (node === undefined || node.type !== 'COMPONENT') return undefined;
		return node;
	});
	const settings = $derived(component === undefined ? undefined : readComponentSettings(component));
	const instanceCount = $derived(
		component === undefined ? 0 : ctx.componentSync.instancesOf(component.id).length
	);

	let anchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function openConfiguration(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		anchor = { x: box.left, y: box.top, width: box.width, height: box.height };
	}

	function setDescription(event: Event): void {
		if (component === undefined || !(event.currentTarget instanceof HTMLTextAreaElement)) return;
		applyEdit(
			ctx,
			ctx.document.setProps(component.id, { description: event.currentTarget.value }),
			'Edit component description'
		);
	}

	function setSetting(key: string, value: string): void {
		if (component === undefined) return;
		const own = component.pluginData[COMPONENT_NAMESPACE];
		const pluginData = {
			...component.pluginData,
			[COMPONENT_NAMESPACE]: { ...own, [key]: value }
		};
		applyEdit(ctx, ctx.document.setProps(component.id, { pluginData }), 'Edit component settings');
	}

	function setLink(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		setSetting('documentationLink', event.currentTarget.value);
	}

	function setSimplify(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		setSetting('simplifyInstances', String(event.currentTarget.checked));
	}
</script>

{#if component !== undefined && settings !== undefined}
	<div class="flex flex-col gap-2 px-3 pb-3" data-component-section>
		<div class="text-violet flex items-center gap-2 text-xs">
			<DiamondsFourIcon size={14} />
			<span class="min-w-0 flex-1 truncate font-medium" data-component-name>{component.name}</span>
			<IconToggleButton icon={GearSixIcon} label="Edit component" onclick={openConfiguration} />
		</div>
		{#if component.description !== ''}
			<p class="text-muted text-xs" data-component-description>{component.description}</p>
		{/if}
		<div class="flex items-center justify-between gap-2">
			<span class="text-faint text-xs">
				{instanceCount === 1 ? '1 instance' : `${instanceCount} instances`}
			</span>
			<Button size="sm" onclick={() => createInstances(ctx)}>Create instance</Button>
		</div>
	</div>
{/if}

{#if anchor !== null && component !== undefined && settings !== undefined}
	<Popover {anchor} label="Component configuration" width={260} onclose={() => (anchor = null)}>
		<div class="flex flex-col gap-3 p-3" data-component-configuration>
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted">Description</span>
				<textarea
					aria-label="Component description"
					rows="3"
					class="bg-input border-line text-default resize-none rounded-sm border px-2 py-1 text-xs outline-none"
					value={component.description}
					onchange={setDescription}></textarea>
			</label>
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-muted">Documentation link</span>
				<input
					aria-label="Documentation link"
					type="url"
					placeholder="https://"
					class="bg-input border-line text-default rounded-sm border px-2 py-1 text-xs outline-none"
					value={settings.documentationLink}
					onchange={setLink}
				/>
			</label>
			<label class="flex items-center gap-2 text-xs">
				<input
					aria-label="Simplify instances"
					type="checkbox"
					checked={settings.simplifyInstances}
					onchange={setSimplify}
				/>
				<span class="text-default">Simplify instances</span>
			</label>
		</div>
	</Popover>
{/if}
