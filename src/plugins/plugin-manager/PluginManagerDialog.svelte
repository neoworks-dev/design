<script lang="ts">
	// The plugin manager: installed plugins with their state, what they may do and what can be done
	// with them. Drop a plugin folder or .zip on it to install.
	import { Button, Checkbox, StatusBadge } from '@neoworks-dev/ui';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';
	import type { PluginPermission } from '../../lib/plugins/manifest';
	import type { PluginStatus } from '../../lib/plugins/types';
	import type { PluginRow } from '../../lib/services/pluginManager';
	import { describePermission } from '../../lib/plugins/describePermission';

	const ctx = getKernel();
	const manager = ctx.pluginManager;
	const rows = $derived(manager.rows());
	const hasProjectPlugins = $derived(rows.some((row) => row.source === 'project'));
	const showTrust = $derived(
		manager.project !== null && (hasProjectPlugins || manager.projectTrust === 'undecided')
	);

	const TRUST_LABELS = {
		trusted: 'trusted',
		untrusted: 'not trusted',
		undecided: 'not decided yet'
	};
	const trustLabel = $derived.by(() => {
		const trust = manager.projectTrust;
		if (trust === null) return '';
		return TRUST_LABELS[trust];
	});

	type Tone = 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'neutral';
	const TONES: Record<PluginStatus, Tone> = {
		active: 'green',
		inactive: 'neutral',
		failed: 'red',
		invalid: 'red',
		incompatible: 'amber',
		untrusted: 'amber',
		shadowed: 'neutral',
		disabled: 'neutral'
	};
	const SOURCES = { builtin: 'Bundled', user: 'Installed', project: 'Project' };

	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !manager.isOpen) return;
		event.preventDefault();
		event.stopPropagation();
		manager.closeDialog();
	}

	function checked(event: Event): boolean {
		return event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked;
	}

	function togglePermission(row: PluginRow, permission: PluginPermission, event: Event): void {
		void manager.setPermission(row.id, permission, checked(event));
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		manager.setDragging(false);
		const files = event.dataTransfer?.files;
		if (files === undefined) return;
		for (const file of Array.from(files)) {
			const path = ctx.desktop.pathForFile(file);
			if (path !== '') void manager.installPath(path);
		}
	}

	function onDragOver(event: DragEvent): void {
		event.preventDefault();
		manager.setDragging(true);
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if manager.isOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		data-plugin-manager
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) manager.closeDialog();
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Plugins"
			tabindex="-1"
			class={[
				'bg-elevated flex max-h-[80vh] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-lg',
				manager.dragging ? 'border-action' : 'border-line'
			]}
			ondragover={onDragOver}
			ondragleave={() => manager.setDragging(false)}
			ondrop={onDrop}
		>
			<header
				class="border-line-faint flex h-11 shrink-0 items-center justify-between border-b px-4"
			>
				<h2 class="text-default text-sm font-semibold">Plugins</h2>
				<div class="flex items-center gap-2">
					<Button size="sm" onclick={() => void manager.installFromDialog('folder')}>
						Install from folder
					</Button>
					<Button size="sm" onclick={() => void manager.installFromDialog('zip')}>
						Install from .zip
					</Button>
					<button
						type="button"
						aria-label="Close"
						class="text-muted hover:text-default rounded-sm p-1"
						onclick={() => manager.closeDialog()}
					>
						<XIcon size={14} />
					</button>
				</div>
			</header>

			{#if showTrust}
				<div
					class="border-line-faint bg-raised flex items-center justify-between gap-3 border-b px-4 py-2 text-xs"
					data-plugin-trust
				>
					<span class="text-default min-w-0 truncate">
						Plugins of this project: {trustLabel}
					</span>
					<span class="flex shrink-0 gap-2">
						{#if manager.projectTrust !== 'trusted'}
							<Button size="sm" variant="primary" onclick={() => void manager.trustProject(true)}>
								Trust
							</Button>
						{/if}
						{#if manager.projectTrust !== 'untrusted'}
							<Button size="sm" onclick={() => void manager.trustProject(false)}>Don't trust</Button
							>
						{/if}
					</span>
				</div>
			{/if}

			<ul class="min-h-0 flex-1 overflow-y-auto" data-plugin-list>
				{#each rows as row (row.id)}
					{@const expanded = manager.expandedId === row.id}
					<li class="border-line-faint border-b last:border-b-0" data-plugin-row={row.id}>
						<div class="flex items-center gap-2 px-4 py-2">
							<button
								type="button"
								class="text-default flex min-w-0 flex-1 items-center gap-2 text-left"
								aria-expanded={expanded}
								onclick={() => manager.expand(row.id)}
							>
								{#if expanded}
									<CaretDownIcon size={12} class="text-muted shrink-0" />
								{:else}
									<CaretRightIcon size={12} class="text-muted shrink-0" />
								{/if}
								<span class="truncate text-xs font-medium">{row.name}</span>
								{#if row.version}<span class="text-faint text-2xs">{row.version}</span>{/if}
								<StatusBadge tone={TONES[row.status]}>{row.status}</StatusBadge>
								<span class="text-faint text-2xs">{SOURCES[row.source]}</span>
							</button>
							{#if row.switchable}
								<Button
									size="sm"
									variant="ghost"
									onclick={() => void manager.setEnabled(row.id, !row.enabled)}
								>
									{row.enabled ? 'Disable' : 'Enable'}
								</Button>
							{/if}
							{#if row.commands.length > 0 && row.enabled && row.status !== 'invalid'}
								<Button
									size="sm"
									variant="primary"
									onclick={() => void manager.run(row.id, row.commands[0].id)}
								>
									Run
								</Button>
							{/if}
						</div>
						{#if expanded}
							<div class="text-default flex flex-col gap-3 px-10 pt-1 pb-3 text-xs">
								{#if row.description}<p class="text-muted">{row.description}</p>{/if}
								{#if row.problem}<p class="text-red">{row.problem}</p>{/if}
								{#each row.warnings as warning (warning)}
									<p class="text-amber">{warning}</p>
								{/each}
								{#if row.commands.length > 0}
									<div class="flex flex-col gap-1">
										<span class="text-faint text-2xs uppercase">Commands</span>
										{#each row.commands as command (command.id)}
											<div class="flex items-center justify-between gap-2">
												<span class="truncate">{command.title}</span>
												<Button
													size="sm"
													disabled={!row.enabled}
													onclick={() => void manager.run(row.id, command.id)}
												>
													Run
												</Button>
											</div>
										{/each}
									</div>
								{/if}
								{#if row.permissions.length > 0}
									<div class="flex flex-col gap-1" data-plugin-permissions>
										<span class="text-faint text-2xs uppercase">Allowed to</span>
										{#each row.permissions as entry (entry.permission)}
											<label class="flex items-center gap-2">
												<Checkbox
													size="sm"
													checked={entry.decision === 'granted'}
													disabled={row.source === 'builtin'}
													aria-label={describePermission(entry.permission)}
													onchange={(event: Event) =>
														togglePermission(row, entry.permission, event)}
												/>
												<span>{describePermission(entry.permission)}</span>
												{#if entry.decision === 'undecided' && row.source !== 'builtin'}
													<span class="text-faint">(not asked yet)</span>
												{/if}
												{#if entry.permission === 'network' && row.allowedDomains.length > 0}
													<span class="text-muted">({row.allowedDomains.join(', ')})</span>
												{/if}
											</label>
										{/each}
									</div>
								{/if}
								<div class="flex gap-2">
									{#if row.status === 'active'}
										<Button size="sm" onclick={() => void manager.restart(row.id)}>Restart</Button>
									{/if}
									<Button size="sm" onclick={() => void manager.reveal(row.id)}>Show folder</Button>
									{#if row.removable}
										<Button size="sm" variant="danger" onclick={() => void manager.remove(row.id)}>
											Remove
										</Button>
									{/if}
								</div>
							</div>
						{/if}
					</li>
				{:else}
					<li class="text-faint px-4 py-8 text-center text-xs" data-plugin-empty>
						No plugins installed. Install one from a folder or .zip, or drop it here.
					</li>
				{/each}
			</ul>

			{#if manager.notice}
				<footer
					class={[
						'border-line-faint border-t px-4 py-2 text-xs',
						manager.notice.error ? 'text-red' : 'text-muted'
					]}
					role="status"
				>
					{manager.notice.text}
				</footer>
			{/if}
		</div>
	</div>
{/if}
