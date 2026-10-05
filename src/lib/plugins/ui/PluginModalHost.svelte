<script lang="ts">
	// The modals plugins open with `design.ui.showModal`: a dialog over the app with the surface in
	// it. Escape or the backdrop closes the top one.
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../kernel/context';
	import SurfaceView from './SurfaceView.svelte';

	const ctx = getKernel();
	const modals = $derived(ctx.pluginUi.openModals());

	function close(pluginId: string, surfaceId: string): void {
		ctx.pluginUi.closeFromUser(pluginId, surfaceId);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		const top = modals.at(-1);
		if (top === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		close(top.pluginId, top.surfaceId);
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#each modals as modal (modal.key)}
	{#if modal.modal}
		<div
			class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			role="presentation"
			data-plugin-modal={modal.surfaceId}
			onpointerdown={(event) => {
				if (event.target === event.currentTarget) close(modal.pluginId, modal.surfaceId);
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={modal.modal.title}
				class="bg-elevated border-line flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-lg border shadow-lg"
				style:width="{modal.modal.width}px"
				style:min-height="{modal.modal.height}px"
			>
				<header
					class="border-line-faint flex h-10 shrink-0 items-center justify-between border-b px-3"
				>
					<h2 class="text-default text-xs font-semibold">{modal.modal.title}</h2>
					<button
						type="button"
						aria-label="Close"
						class="text-muted hover:text-default rounded-sm p-1"
						onclick={() => close(modal.pluginId, modal.surfaceId)}
					>
						<XIcon size={14} />
					</button>
				</header>
				<div class="min-h-0 flex-1 overflow-auto">
					<SurfaceView pluginId={modal.pluginId} surfaceId={modal.surfaceId} />
				</div>
			</div>
		</div>
	{/if}
{/each}
