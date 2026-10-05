<script lang="ts">
	import { Button, Select } from '@neoworks-dev/ui';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { formatConstraint, SCALE_PRESETS } from '../../lib/export/settings';
	import type { ExportFormatName } from '../../lib/export/types';
	import { getKernel } from '../../lib/kernel/context';
	import type { ExportScope } from '../../lib/services/exportDialogState.svelte';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();
	const dialog = ctx.exportDialog;

	const SCOPES: Array<{ value: ExportScope; label: string }> = [
		{ value: 'selection', label: 'Selection' },
		{ value: 'all', label: 'All with export settings' },
		{ value: 'slices', label: 'All slices' }
	];
	const KEEP = 'stored';

	const jobs = $derived.by(() => {
		if (!dialog.isOpen) return [];
		return dialog.jobs();
	});
	const current = $derived(jobs[Math.min(dialog.previewIndex, Math.max(jobs.length - 1, 0))]);
	const preview = $derived(dialog.preview);
	const formatOptions = $derived([
		{ value: KEEP, label: 'As set on layers' },
		...ctx.export.formats.list().map((format) => ({ value: format.id, label: format.label }))
	]);
	const sizeOptions = $derived([
		{ value: KEEP, label: 'As set on layers' },
		...SCALE_PRESETS.map((scale) => ({
			value: formatConstraint({ type: 'SCALE', value: scale }),
			label: formatConstraint({ type: 'SCALE', value: scale })
		}))
	]);

	function onkeydown(event: KeyboardEvent): void {
		if (!dialog.isOpen) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		dialog.close();
	}

	async function exportAssets(): Promise<void> {
		const paths = await dialog.exportAssets();
		if (paths !== null) dialog.close();
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if dialog.isOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) dialog.close();
		}}
	>
		<div
			role="dialog"
			aria-label="Export"
			data-export-dialog
			class="bg-elevated border-line text-default flex h-[520px] max-h-[92vh] w-[720px] max-w-[95vw] flex-col rounded-lg border shadow-lg"
		>
			<div class="border-line-faint flex shrink-0 items-center border-b px-4 py-3">
				<h2 class="text-sm font-semibold">Export</h2>
			</div>

			<div class="flex min-h-0 flex-1">
				<div class="border-line-faint flex w-64 shrink-0 flex-col gap-3 border-r p-4 text-xs">
					<div class="flex flex-col gap-1">
						<span class="text-muted">Assets</span>
						<Select
							size="sm"
							value={dialog.scope}
							options={SCOPES}
							onChange={(next) => {
								if (typeof next === 'string') dialog.setScope(next as ExportScope);
							}}
						/>
						<span class="text-faint" data-export-count>{jobs.length} file(s)</span>
					</div>
					<div class="flex flex-col gap-1">
						<span class="text-muted">File type</span>
						<Select
							size="sm"
							value={dialog.format === null ? KEEP : dialog.format}
							options={formatOptions}
							onChange={(next) => {
								if (typeof next !== 'string') return;
								if (next === KEEP) dialog.setFormat(null);
								else dialog.setFormat(next as ExportFormatName);
							}}
						/>
					</div>
					<div class="flex flex-col gap-1">
						<span class="text-muted">Size</span>
						<Select
							size="sm"
							value={dialog.sizeText === null ? KEEP : dialog.sizeText}
							options={sizeOptions}
							onChange={(next) => {
								if (typeof next !== 'string') return;
								if (next === KEEP) dialog.setSizeText(null);
								else dialog.setSizeText(next);
							}}
						/>
					</div>
					<div class="flex flex-col gap-1">
						<span class="text-muted">Color profile</span>
						<Select
							size="sm"
							value="srgb"
							disabled
							options={[{ value: 'srgb', label: 'Same as file (sRGB)' }]}
							onChange={() => undefined}
						/>
					</div>
				</div>

				<div class="flex min-w-0 flex-1 flex-col p-4" data-export-preview-pane>
					<div
						class="bg-raised border-line-faint flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded border"
					>
						{#if jobs.length === 0}
							<p class="text-muted px-6 text-center text-xs" data-export-empty>
								Nothing to export. Select layers, or add export settings or slices first.
							</p>
						{:else if preview !== null && preview.status === 'ready' && preview.url !== null}
							<img
								src={preview.url}
								alt="Preview of {current.fileName}"
								class="max-h-full max-w-full object-contain"
								data-export-dialog-preview
							/>
						{:else if preview !== null && preview.status === 'loading'}
							<span class="text-muted text-xs">Rendering...</span>
						{:else if preview !== null}
							<span class="text-muted px-6 text-center text-xs">{preview.message}</span>
						{/if}
					</div>
					{#if jobs.length > 0 && current !== undefined}
						<div class="mt-2 flex items-center gap-2 text-xs">
							<IconButton
								icon={CaretLeftIcon}
								label="Previous file"
								onclick={() => dialog.showPreview(dialog.previewIndex - 1)}
							/>
							<div class="min-w-0 flex-1 text-center">
								<div class="truncate font-medium" data-export-file-name>{current.fileName}</div>
								<div class="text-faint" data-export-file-info>
									{dialog.previewIndex + 1} of {jobs.length}{#if preview !== null && preview.status === 'ready'}
										&middot; {preview.width} x {preview.height} &middot; {formatBytes(
											preview.bytes
										)}{/if}
								</div>
							</div>
							<IconButton
								icon={CaretRightIcon}
								label="Next file"
								onclick={() => dialog.showPreview(dialog.previewIndex + 1)}
							/>
						</div>
					{/if}
				</div>
			</div>

			<div class="border-line-faint flex h-12 shrink-0 items-center gap-2 border-t px-4">
				<span
					class={['min-w-0 flex-1 truncate text-xs', dialog.status?.kind === 'error' && 'text-red']}
					role="status"
					data-export-status
				>
					{dialog.status === null ? '' : dialog.status.text}
				</span>
				<Button size="sm" variant="ghost" onclick={() => dialog.close()}>Cancel</Button>
				<Button
					size="sm"
					variant="surface"
					disabled={jobs.length === 0 || dialog.busy}
					onclick={() => void dialog.copyToClipboard()}
				>
					Copy as PNG
				</Button>
				<Button
					size="sm"
					variant="primary"
					disabled={jobs.length === 0 || dialog.busy || !dialog.sizeIsValid}
					onclick={() => void exportAssets()}
				>
					Export asset
				</Button>
			</div>
		</div>
	</div>
{/if}
