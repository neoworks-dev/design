<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const rename = ctx.aiRename;

	const suggestion = $derived(rename.suggestion);
	const notice = $derived(rename.notice);
	const running = $derived(rename.running);
</script>

{#if running || notice !== '' || suggestion}
	<div
		class="bg-elevated border-line text-default pointer-events-auto absolute bottom-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border py-2 pr-2 pl-3 text-xs shadow-lg"
		data-ai-rename-toast
	>
		{#if running}
			<span>Renaming layers…</span>
		{:else if notice !== ''}
			<span>{notice}</span>
			<button
				type="button"
				class="text-muted hover:text-default p-1"
				aria-label="Close"
				onclick={() => rename.dismiss()}
			>
				<XIcon size={12} />
			</button>
		{:else if suggestion}
			<span>Missing {suggestion.count} layer name{suggestion.count === 1 ? '' : 's'}</span>
			<Button size="sm" variant="primary" onclick={() => void rename.renameLayers()}>
				Rename layers
			</Button>
			<button
				type="button"
				class="text-muted hover:text-default p-1"
				aria-label="Dismiss"
				onclick={() => rename.dismiss()}
			>
				<XIcon size={12} />
			</button>
		{/if}
	</div>
{/if}
