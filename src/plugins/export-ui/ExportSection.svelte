<script lang="ts">
	import { Button, Select } from '@neoworks-dev/ui';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import type { ExportSetting } from '../../lib/document';
	import { objectUrlFor } from '../../lib/export/objectUrl';
	import {
		formatConstraint,
		parseConstraint,
		suffixForConstraint
	} from '../../lib/export/settings';
	import type { ExportFormatName } from '../../lib/export/types';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();

	const ids = $derived(ctx.selection.ids.filter((id) => ctx.document.has(id)));
	const settings = $derived.by((): ExportSetting[] => {
		const [first] = ids;
		if (first === undefined) return [];
		return ctx.export.settingsOf(first);
	});
	const formatOptions = $derived(
		ctx.export.formats.list().map((format) => ({ value: format.id, label: format.label }))
	);
	const buttonLabel = $derived.by(() => {
		if (ids.length === 1) return `Export ${ctx.document.require(ids[0]).name}`;
		return `Export ${ids.length} layers`;
	});

	let busy = $state(false);
	let message = $state<string | null>(null);
	let previewUrl = $state<string | null>(null);
	let previewInfo = $state('');

	function setSize(index: number, text: string, input: HTMLInputElement): void {
		const constraint = parseConstraint(text);
		if (constraint === null) {
			input.value = formatConstraint(settings[index].constraint);
			return;
		}
		ctx.export.updateSetting(ids, index, { constraint });
	}

	function setSuffix(index: number, suffix: string): void {
		ctx.export.updateSetting(ids, index, { suffix });
	}

	function setFormat(index: number, format: string): void {
		ctx.export.updateSetting(ids, index, { format: format as ExportFormatName });
	}

	function addSetting(): void {
		const last = settings.at(-1);
		if (last === undefined) {
			ctx.export.addSetting(ids);
			return;
		}
		const constraint = { ...last.constraint };
		ctx.export.addSetting(ids, {
			suffix: suffixForConstraint(constraint),
			format: last.format,
			constraint
		});
	}

	async function exportNow(): Promise<void> {
		busy = true;
		message = null;
		try {
			const files = await ctx.export.run(ids);
			const paths = await ctx.export.save(files);
			if (paths === null) message = 'Export cancelled';
			else message = `Exported ${paths.length} file(s)`;
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	// A preview of the first file this selection would export, kept in step with the settings.
	$effect(() => {
		const key = JSON.stringify([ids, settings]);
		void key;
		let cancelled = false;
		let url: string | null = null;
		const [first] = ids;
		if (first === undefined) return;
		void renderPreview(first).then((result) => {
			if (cancelled || result === null) {
				if (result !== null) URL.revokeObjectURL(result.url);
				return;
			}
			url = result.url;
			previewUrl = result.url;
			previewInfo = result.info;
		});
		return () => {
			cancelled = true;
			previewUrl = null;
			if (url !== null) URL.revokeObjectURL(url);
		};
	});

	async function renderPreview(id: string): Promise<{ url: string; info: string } | null> {
		const [job] = ctx.export.plan([id]);
		if (job.setting.format === 'PDF') return null;
		try {
			const file = await ctx.export.renderJob(job);
			const url = objectUrlFor(file.bytes, file.mimeType);
			return { url, info: `${job.fileName}  ${file.width} x ${file.height}` };
		} catch {
			return null;
		}
	}
</script>

<div class="flex flex-col gap-2 px-3 pb-3" data-export-section>
	<div class="flex items-center justify-between">
		<span class="text-muted text-[11px]">{settings.length === 0 ? 'No export settings' : ''}</span>
		<IconButton icon={PlusIcon} label="Add export setting" onclick={addSetting} />
	</div>

	{#each settings as setting, index (index)}
		<div class="flex items-center gap-1.5" data-export-setting={index}>
			<input
				class="bg-input border-line text-default h-7 w-12 rounded border px-1.5 text-xs"
				aria-label="Export size"
				value={formatConstraint(setting.constraint)}
				onchange={(event) => setSize(index, event.currentTarget.value, event.currentTarget)}
			/>
			<input
				class="bg-input border-line text-default h-7 min-w-0 flex-1 rounded border px-1.5 text-xs"
				aria-label="Export suffix"
				placeholder="Suffix"
				value={setting.suffix}
				onchange={(event) => setSuffix(index, event.currentTarget.value)}
			/>
			<div class="w-[5.5rem] shrink-0">
				<Select
					size="sm"
					value={setting.format}
					options={formatOptions}
					onChange={(next) => {
						if (typeof next === 'string') setFormat(index, next);
					}}
				/>
			</div>
			<IconButton
				icon={MinusIcon}
				label="Remove export setting"
				onclick={() => ctx.export.removeSetting(ids, index)}
			/>
		</div>
	{/each}

	{#if settings.length > 0}
		<div data-export-run>
			<Button size="sm" variant="surface" full disabled={busy} onclick={() => void exportNow()}>
				{buttonLabel}
			</Button>
		</div>
	{/if}
	<Button size="sm" variant="ghost" full onclick={() => ctx.exportDialog.open('selection')}>
		Export dialog...
	</Button>

	{#if previewUrl !== null}
		<div class="bg-raised border-line-faint flex flex-col items-center gap-1 rounded border p-2">
			<img
				src={previewUrl}
				alt="Export preview"
				class="max-h-32 max-w-full object-contain"
				data-export-preview
			/>
			<span class="text-faint max-w-full truncate text-[10px]">{previewInfo}</span>
		</div>
	{/if}
	{#if message !== null}
		<p class="text-muted text-[11px]" role="status" data-export-message>{message}</p>
	{/if}
</div>
