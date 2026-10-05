<script lang="ts">
	// The first-run question for a plugin: what it asks to be allowed, and Allow or Deny. The oldest
	// question is shown; Escape denies it.
	import { Button } from '@neoworks-dev/ui';
	import { getKernel } from '../../lib/kernel/context';
	import { describePermission } from '../../lib/plugins/describePermission';

	const ctx = getKernel();
	const prompt = $derived(ctx.pluginPermissions.prompts.list()[0]);

	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || prompt === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		prompt.answer(false);
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if prompt !== undefined}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		data-plugin-permission-prompt={prompt.pluginId}
	>
		<div
			role="alertdialog"
			aria-modal="true"
			aria-label="Allow {prompt.pluginName}?"
			class="bg-elevated border-line flex w-[360px] max-w-[90vw] flex-col gap-3 rounded-lg border p-4 shadow-lg"
		>
			<h2 class="text-default text-sm font-semibold">Allow {prompt.pluginName}?</h2>
			<p class="text-muted text-xs">This plugin asks to be allowed to:</p>
			<ul class="flex flex-col gap-1">
				{#each prompt.permissions as permission (permission)}
					<li class="text-default text-xs">
						{describePermission(permission)}
						{#if permission === 'network' && prompt.allowedDomains.length > 0}
							<span class="text-muted">({prompt.allowedDomains.join(', ')})</span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="text-faint text-xs">You can change this later in the plugin manager.</p>
			<div class="flex justify-end gap-2">
				<Button size="sm" variant="ghost" onclick={() => prompt.answer(false)}>Deny</Button>
				<Button size="sm" variant="primary" onclick={() => prompt.answer(true)}>Allow</Button>
			</div>
		</div>
	</div>
{/if}
