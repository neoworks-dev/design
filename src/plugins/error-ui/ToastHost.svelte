<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const errorUi = ctx.errorUi;

	// A plugin that fails after boot (a retry that failed again, a restart) shows up here.
	$effect(() => {
		errorUi.announceNewFailures();
	});
</script>

{#if errorUi.toasts.length > 0}
	<div
		class="pointer-events-none fixed right-4 bottom-4 z-40 flex w-80 flex-col gap-2"
		data-error-ui-toasts
	>
		{#each errorUi.toasts as toast (toast.id)}
			<div
				role={toast.kind === 'error' ? 'alert' : 'status'}
				data-error-ui-toast={toast.kind}
				class={[
					'bg-elevated pointer-events-auto flex items-start gap-2 rounded-lg border py-2 pr-2 pl-3 text-xs shadow-lg',
					toast.kind === 'error' ? 'border-red/40 text-red' : 'border-line text-default'
				]}
			>
				<span class="min-w-0 flex-1 break-words">{toast.message}</span>
				{#if toast.kind === 'error'}
					<button
						type="button"
						class="text-muted hover:text-default shrink-0 underline"
						onclick={() => errorUi.open('plugins')}>Details</button
					>
				{/if}
				<button
					type="button"
					class="text-muted hover:text-default shrink-0 p-1"
					aria-label="Dismiss"
					onclick={() => errorUi.dismissToast(toast.id)}
				>
					<XIcon size={12} />
				</button>
			</div>
		{/each}
	</div>
{/if}
