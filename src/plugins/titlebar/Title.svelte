<script lang="ts">
	import { tick } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import {
		documentTitleOf,
		isDocumentRenamable,
		isDocumentSaving,
		isRenamingTitle
	} from './documentTitle.svelte';

	const ctx = getKernel();
	const title = $derived(documentTitleOf(ctx.contextKeys));
	const renamable = $derived(isDocumentRenamable(ctx.contextKeys));
	const saving = $derived(isDocumentSaving(ctx.contextKeys));
	const renaming = $derived(renamable && isRenamingTitle(ctx.contextKeys));
	// macOS draws its traffic lights over the top-left corner of the window.
	const insetForTrafficLights = ctx.desktop.platform === 'darwin';

	let draft = $state('');
	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (!renaming) return;
		draft = title;
		tick()
			.then(() => input?.select())
			.catch((error: unknown) => ctx.logger.error('titlebar', error));
	});

	function stopRenaming(): void {
		ctx.contextKeys.set('titlebar.renaming', false);
	}

	function commit(): void {
		if (!renaming) return;
		const name = draft.trim();
		const unchanged = name === '' || name === title;
		stopRenaming();
		if (unchanged) return;
		ctx.commands
			.run('file.rename', { name })
			.catch((error: unknown) => ctx.logger.error('titlebar', error));
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') commit();
		if (event.key === 'Escape') stopRenaming();
	}
</script>

<!-- Double click toggles maximize like a native title bar; on the file name it renames. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="app-drag text-muted flex min-w-0 flex-1 items-center gap-3 px-3 text-xs"
	class:pl-20={insetForTrafficLights}
	data-titlebar
	ondblclick={() => void ctx.commands.run('titlebar.toggle-maximize')}
>
	<span class="text-dim shrink-0 font-medium">Draftboard</span>
	<span class="flex min-w-0 flex-1 items-center justify-center gap-2">
		{#if renaming}
			<input
				bind:this={input}
				bind:value={draft}
				class="app-no-drag bg-input border-line text-default w-56 rounded border px-2 py-0.5 text-center text-xs font-medium outline-none"
				aria-label="File name"
				data-title-input
				onkeydown={onKeydown}
				onblur={commit}
				ondblclick={(event) => event.stopPropagation()}
			/>
		{:else if renamable}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="app-no-drag text-default min-w-0 truncate font-medium"
				data-document-title
				title="Double click to rename"
				ondblclick={(event) => {
					event.stopPropagation();
					void ctx.commands.run('file.rename');
				}}>{title}</span
			>
		{/if}
		{#if renamable}
			<span class="text-faint shrink-0" data-save-status>{saving ? 'Saving...' : 'Saved'}</span>
		{/if}
	</span>
	<span class="w-24 shrink-0"></span>
</div>
