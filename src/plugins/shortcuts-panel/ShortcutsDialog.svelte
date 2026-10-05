<script lang="ts">
	import { Button, Select } from '@neoworks-dev/ui';
	import { tick } from 'svelte';
	import { getKernel } from '../../lib/kernel/context';
	import type { ShortcutRow } from '../../lib/shortcuts/rows';

	const ctx = getKernel();
	const panel = ctx.shortcutsPanel;

	const groups = $derived.by(() => {
		if (!panel.isOpen) return [];
		return panel.groups();
	});
	const recording = $derived(panel.recording);
	const conflict = $derived(panel.conflict);

	let search: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (panel.isOpen) void tick().then(() => search?.focus());
	});

	// The panel owns the keyboard while it is open: app shortcuts must not fire through it, and
	// while a chord is being recorded every key press is the answer.
	function onkeydown(event: KeyboardEvent): void {
		if (!panel.isOpen) return;
		if (recording !== null) {
			event.preventDefault();
			event.stopPropagation();
			panel.recordEvent(event);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			panel.close();
		}
	}

	function isRecording(row: ShortcutRow, scope: string): boolean {
		return recording !== null && recording.commandId === row.commandId && recording.scope === scope;
	}

	function scopeLabel(scope: string): string {
		if (scope === 'global') return '';
		return `${scope} · `;
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if panel.isOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) panel.close();
		}}
	>
		<div
			role="dialog"
			aria-label="Keyboard shortcuts"
			data-shortcuts-dialog
			class="bg-elevated border-line text-default flex h-[600px] max-h-[92vh] w-[760px] max-w-[95vw] flex-col rounded-lg border shadow-lg"
		>
			<div class="border-line-faint flex shrink-0 items-center gap-3 border-b px-4 py-3">
				<h2 class="text-sm font-semibold">Keyboard shortcuts</h2>
				<div class="flex-1"></div>
				<div class="w-36">
					<Select
						size="sm"
						value={panel.preset}
						options={panel.presets.map((preset) => ({ value: preset.id, label: preset.title }))}
						onChange={(next) => {
							if (typeof next === 'string') panel.setPreset(next);
						}}
					/>
				</div>
				<Button size="sm" variant="ghost" onclick={() => panel.close()}>Close</Button>
			</div>

			<div class="border-line-faint shrink-0 border-b px-4 py-2">
				<input
					bind:this={search}
					class="bg-input border-line text-default h-8 w-full rounded border px-2 text-xs"
					placeholder="Search by command or shortcut"
					aria-label="Search shortcuts"
					value={panel.query}
					oninput={(event) => panel.setQuery(event.currentTarget.value)}
				/>
			</div>

			{#if conflict}
				<div
					class="border-line-faint bg-raised flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs"
					role="alert"
					data-shortcut-conflict
				>
					<span class="flex-1">
						<strong>{conflict.display}</strong> is already used by {conflict.holders.join(', ')}.
					</span>
					<Button size="sm" variant="primary" onclick={() => panel.confirmReplace()}>Replace</Button
					>
					<Button size="sm" variant="ghost" onclick={() => panel.cancelRecording()}>Cancel</Button>
				</div>
			{/if}

			<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-3" data-shortcut-list>
				{#each groups as group (group.category)}
					<h3 class="text-muted bg-elevated sticky top-0 py-2 text-xs font-semibold">
						{group.category}
					</h3>
					{#each group.rows as row (row.commandId)}
						<div
							class="border-line-faint flex items-center gap-3 border-b py-1.5 text-xs"
							data-shortcut-row={row.commandId}
						>
							<div class="min-w-0 flex-1">
								<div class="truncate">{row.title}</div>
								<div class="text-faint truncate">{row.commandId}</div>
							</div>
							<div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
								{#each row.bindings as binding, position (position)}
									{#if isRecording(row, binding.scope)}
										<span
											class="border-action text-default rounded border px-2 py-0.5"
											data-recording
										>
											Press the new shortcut...
										</span>
									{:else}
										<button
											type="button"
											class="bg-input border-line hover:border-line-strong flex flex-col items-start rounded border px-2 py-0.5 text-left"
											aria-label="Change shortcut {binding.display} of {row.title}"
											onclick={() => panel.startRecording(row.commandId, binding.scope)}
										>
											<span class="font-medium">{binding.display}</span>
											<span class="text-faint text-[10px]"
												>{scopeLabel(binding.scope)}{binding.source}</span
											>
										</button>
										<button
											type="button"
											class="text-faint hover:text-default"
											aria-label="Remove shortcut {binding.display} of {row.title}"
											onclick={() => panel.unbind(row.commandId, binding.scope)}
										>
											×
										</button>
									{/if}
								{/each}
								{#if row.bindings.length === 0}
									{#if isRecording(row, 'global')}
										<span
											class="border-action text-default rounded border px-2 py-0.5"
											data-recording
										>
											Press the new shortcut...
										</span>
									{:else}
										<button
											type="button"
											class="text-muted hover:text-default border-line rounded border border-dashed px-2 py-0.5"
											aria-label="Add a shortcut for {row.title}"
											onclick={() => panel.startRecording(row.commandId)}
										>
											Add
										</button>
									{/if}
								{/if}
								<button
									type="button"
									class="text-muted hover:text-default disabled:opacity-30"
									disabled={!row.modified}
									aria-label="Reset the shortcut of {row.title}"
									onclick={() => panel.reset(row.commandId)}
								>
									Reset
								</button>
							</div>
						</div>
					{/each}
				{:else}
					<p class="text-muted py-8 text-center text-xs">
						No command or shortcut matches "{panel.query}".
					</p>
				{/each}
			</div>

			<div class="border-line-faint flex h-11 shrink-0 items-center justify-between border-t px-4">
				<span class="text-faint text-xs">Click a shortcut to record a new one. Esc cancels.</span>
				<Button size="sm" variant="surface" onclick={() => panel.resetAll()}>
					Reset all to defaults
				</Button>
			</div>
		</div>
	</div>
{/if}
