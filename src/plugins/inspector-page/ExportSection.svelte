<script lang="ts">
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import type { ExportSetting } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';

	const ctx = getKernel();

	const FORMATS = ['PNG', 'JPG', 'SVG', 'PDF', 'WEBP'].map((format) => ({
		value: format,
		label: format
	}));

	const page = $derived(ctx.document.currentPage);
	const settings = $derived.by((): ExportSetting[] => {
		if (page.exportSettings === undefined) return [];
		return page.exportSettings;
	});

	function write(next: ExportSetting[], label: string, gesture: NumberGesture = 'commit'): void {
		let mergeKey: string | undefined;
		if (gesture !== 'commit') mergeKey = `page-export:${page.id}`;
		ctx.document.apply(ctx.document.setProps(page.id, { exportSettings: next }), {
			origin: 'user',
			label,
			mergeKey
		});
	}

	function add(): void {
		const added: ExportSetting = {
			suffix: '',
			format: 'PNG',
			constraint: { type: 'SCALE', value: 1 }
		};
		write([...settings, added], 'Add export setting');
	}

	function remove(index: number): void {
		write(
			settings.filter((_, position) => position !== index),
			'Remove export setting'
		);
	}

	function update(index: number, change: Partial<ExportSetting>, label: string): void {
		write(
			settings.map((setting, position) =>
				position === index ? { ...setting, ...change } : setting
			),
			label
		);
	}

	function setFormat(index: number, format: string): void {
		if (!['PNG', 'JPG', 'SVG', 'PDF', 'WEBP'].includes(format)) return;
		update(index, { format: format as ExportSetting['format'] }, 'Change export format');
	}

	function setScale(index: number, value: number, gesture: NumberGesture): void {
		const setting = settings[index];
		if (setting === undefined) return;
		const next = settings.map((entry, position) =>
			position === index ? { ...entry, constraint: { ...setting.constraint, value } } : entry
		);
		write(next, 'Change export scale', gesture);
	}
</script>

<div class="flex flex-col gap-2 px-4 pb-4" data-export-section>
	<div class="flex justify-end">
		<IconToggleButton icon={PlusIcon} label="Add export setting" onclick={add} />
	</div>
	{#each settings as setting, index (index)}
		<div class="flex flex-col gap-1" data-export-row={index}>
			<div class="flex items-center gap-1">
				<input
					type="text"
					aria-label="Export suffix"
					placeholder="Suffix"
					value={setting.suffix}
					class="bg-input text-default placeholder:text-faint h-8 min-w-0 flex-1 rounded-md border border-transparent px-2 text-xs"
					onchange={(event) =>
						update(index, { suffix: event.currentTarget.value }, 'Change export suffix')}
				/>
				<IconToggleButton
					icon={MinusIcon}
					label="Remove export setting"
					onclick={() => remove(index)}
				/>
			</div>
			<div class="grid grid-cols-2 gap-1">
				<NumberField
					label="x"
					name="Export scale"
					min={0.01}
					step={0.5}
					value={setting.constraint.value}
					onchange={(value, gesture) => setScale(index, value, gesture)}
				/>
				<DropdownField
					options={FORMATS}
					value={setting.format}
					onchange={(format) => setFormat(index, format)}
				/>
			</div>
		</div>
	{/each}
</div>
