<script lang="ts">
	import { Button, StatusBadge } from '@neoworks-dev/ui';
	import { getKernel } from '../../lib/kernel/context';
	import type { PluginBootRecord } from '../../lib/kernel/boot.svelte';

	const ctx = getKernel();
	const errorUi = ctx.errorUi;

	const records = $derived.by((): PluginBootRecord[] => {
		const report = errorUi.report;
		if (report === null) return [];
		return report.records.filter((record) => record.status !== 'active');
	});
	const activeCount = $derived(
		errorUi.report === null
			? 0
			: errorUi.report.records.filter((record) => record.status === 'active').length
	);

	function tone(status: PluginBootRecord['status']): 'red' | 'amber' | 'neutral' | 'green' {
		if (status === 'failed') return 'red';
		if (status === 'pending') return 'amber';
		if (status === 'disabled') return 'neutral';
		return 'green';
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!errorUi.isOpen) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		errorUi.close();
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if errorUi.isOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) errorUi.close();
		}}
	>
		<div
			role="dialog"
			aria-label="Plugin status"
			data-error-ui-dialog
			class="bg-elevated border-line text-default flex h-[460px] max-h-[92vh] w-[640px] max-w-[95vw] flex-col rounded-lg border shadow-lg"
		>
			<div class="border-line-faint flex shrink-0 items-center gap-3 border-b px-4 py-3">
				<h2 class="text-sm font-semibold">Plugin status</h2>
				<div class="flex gap-1 text-xs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={errorUi.tab === 'plugins'}
						class={[
							'rounded px-2 py-1',
							errorUi.tab === 'plugins' ? 'bg-raised text-default' : 'text-muted hover:text-default'
						]}
						onclick={() => errorUi.setTab('plugins')}>Plugins</button
					>
					<button
						type="button"
						role="tab"
						aria-selected={errorUi.tab === 'logs'}
						class={[
							'rounded px-2 py-1',
							errorUi.tab === 'logs' ? 'bg-raised text-default' : 'text-muted hover:text-default'
						]}
						onclick={() => errorUi.setTab('logs')}>Logs</button
					>
				</div>
				<span class="text-faint ml-auto text-xs" data-error-ui-summary>
					{activeCount} active{#if errorUi.safeMode}, safe mode{/if}
				</span>
			</div>

			<div class="min-h-0 flex-1 overflow-auto p-4 text-xs">
				{#if errorUi.tab === 'plugins'}
					{#if records.length === 0}
						<p class="text-muted" data-error-ui-empty>Every plugin loaded.</p>
					{/if}
					<ul class="flex flex-col gap-2">
						{#each records as record (record.name)}
							<li
								class="border-line-faint bg-raised flex items-start gap-3 rounded border p-2"
								data-error-ui-plugin={record.name}
								data-status={record.status}
							>
								<div class="flex min-w-0 flex-1 flex-col gap-1">
									<div class="flex items-center gap-2">
										<span class="font-medium">{record.name}</span>
										<StatusBadge tone={tone(record.status)}>{record.status}</StatusBadge>
									</div>
									{#if record.status === 'failed'}
										<span class="text-red break-words">{record.error}</span>
									{:else if record.status === 'pending'}
										<span class="text-muted">
											Waiting for a service that no loaded plugin provides.
										</span>
									{:else}
										<span class="text-muted">Switched off.</span>
									{/if}
								</div>
								<div class="flex shrink-0 gap-1">
									{#if record.status === 'failed'}
										<Button
											size="sm"
											variant="surface"
											onclick={() => void errorUi.retry(record.name)}>Retry</Button
										>
									{/if}
									{#if record.status === 'failed' || record.status === 'pending'}
										<Button
											size="sm"
											variant="ghost"
											onclick={() => void errorUi.disable(record.name)}>Disable</Button
										>
									{/if}
									{#if record.status === 'disabled' && errorUi.disabledNames.includes(record.name)}
										<Button size="sm" variant="ghost" onclick={() => errorUi.enable(record.name)}
											>Enable next start</Button
										>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="mb-2 flex items-center gap-1">
						<Button
							size="sm"
							variant={errorUi.logSource === 'renderer' ? 'surface' : 'ghost'}
							onclick={() => errorUi.setLogSource('renderer')}>Renderer</Button
						>
						<Button
							size="sm"
							variant={errorUi.logSource === 'main' ? 'surface' : 'ghost'}
							onclick={() => errorUi.setLogSource('main')}>Main</Button
						>
						<Button size="sm" variant="ghost" onclick={() => void errorUi.refreshLogs()}
							>Refresh</Button
						>
					</div>
					<pre
						class="bg-raised border-line-faint text-muted min-h-24 overflow-auto rounded border p-2 font-mono whitespace-pre-wrap"
						data-error-ui-log>{errorUi.logLines.length === 0
							? 'No lines yet.'
							: errorUi.logLines.join('\n')}</pre>
				{/if}
			</div>

			<div class="border-line-faint flex h-12 shrink-0 items-center gap-2 border-t px-4">
				<span class="text-muted min-w-0 flex-1 truncate text-xs" role="status" data-error-ui-status>
					{errorUi.status}
				</span>
				<Button size="sm" variant="ghost" onclick={() => void errorUi.copyDiagnostics()}>
					Copy diagnostics
				</Button>
				<Button size="sm" variant="surface" onclick={() => void errorUi.restart(!errorUi.safeMode)}>
					{errorUi.safeMode ? 'Restart normally' : 'Restart in safe mode'}
				</Button>
				<Button size="sm" variant="primary" onclick={() => errorUi.close()}>Close</Button>
			</div>
		</div>
	</div>
{/if}
