<script lang="ts">
	import ArrowsHorizontalIcon from 'phosphor-svelte/lib/ArrowsHorizontalIcon';
	import ArrowsVerticalIcon from 'phosphor-svelte/lib/ArrowsVerticalIcon';
	import AlignBottomIcon from 'phosphor-svelte/lib/AlignBottomIcon';
	import AlignCenterVerticalIcon from 'phosphor-svelte/lib/AlignCenterVerticalIcon';
	import AlignTopIcon from 'phosphor-svelte/lib/AlignTopIcon';
	import ListBulletsIcon from 'phosphor-svelte/lib/ListBulletsIcon';
	import ListNumbersIcon from 'phosphor-svelte/lib/ListNumbersIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontalIcon';
	import TextAlignCenterIcon from 'phosphor-svelte/lib/TextAlignCenterIcon';
	import TextAlignJustifyIcon from 'phosphor-svelte/lib/TextAlignJustifyIcon';
	import TextAlignLeftIcon from 'phosphor-svelte/lib/TextAlignLeftIcon';
	import TextAlignRightIcon from 'phosphor-svelte/lib/TextAlignRightIcon';
	import TextStrikethroughIcon from 'phosphor-svelte/lib/TextStrikethroughIcon';
	import TextUnderlineIcon from 'phosphor-svelte/lib/TextUnderlineIcon';
	import type { Paragraph, TextNode, TextStyle } from '../../lib/document';
	import { selectedNodes, setSelectionProps } from '../../lib/inspector-inputs/selectionEdit';
	import { sharedValue } from '../../lib/inspector-inputs/values';
	import { getKernel } from '../../lib/kernel/context';
	import DropdownField from '../../lib/ui/DropdownField.svelte';
	import IconToggleButton from '../../lib/ui/IconToggleButton.svelte';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import Popover from '../../lib/ui/Popover.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';
	import ToggleGroup from '../../lib/ui/ToggleGroup.svelte';
	import FontFamilyPicker from './FontFamilyPicker.svelte';
	import {
		decorationValuePatch,
		fontFamilyPatch,
		fontSizeValuePatch,
		fontStylePatch,
		letterSpacingValuePatch,
		lineHeightValuePatch,
		openTypeFeaturePatch,
		OPEN_TYPE_FEATURES,
		shown,
		stylesOfFamily,
		textCasePatch
	} from './typography';

	const ctx = getKernel();

	const textNodes = $derived(
		selectedNodes(ctx).filter((node): node is TextNode => node.type === 'TEXT')
	);
	const style = $derived(ctx.textFormat.style());
	const paragraphs = $derived(ctx.textFormat.touchedParagraphs());

	let settingsAnchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function toggleSettings(event: MouseEvent): void {
		if (settingsAnchor !== null) {
			settingsAnchor = null;
			return;
		}
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const rect = event.currentTarget.getBoundingClientRect();
		settingsAnchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	}

	// ---------- font ----------

	const font = $derived(shown(style.fontName));
	const family = $derived(font.value === null ? null : font.value.family);
	const fontStyle = $derived(font.value === null ? null : font.value.style);
	const missing = $derived(font.value !== null && ctx.fonts.isMissing(font.value));
	const families = $derived(ctx.fonts.families());
	const styleOptions = $derived.by(() => {
		if (family === null) return [];
		const names = stylesOfFamily(ctx.fonts.faces(), family);
		if (fontStyle !== null && !names.includes(fontStyle)) names.push(fontStyle);
		return names.map((name) => ({ value: name, label: name }));
	});

	function setFamily(next: string): void {
		const styles = stylesOfFamily(ctx.fonts.faces(), next);
		ctx.textFormat.applyPatch(fontFamilyPatch(next, styles), 'Font family');
	}

	function setStyle(next: string): void {
		ctx.textFormat.applyPatch(fontStylePatch(next), 'Font style');
	}

	// ---------- size, line height, letter spacing ----------

	const size = $derived(shown(style.fontSize));
	const lineHeight = $derived(shown(style.lineHeight));
	const letterSpacing = $derived(shown(style.letterSpacing));

	function coalesce(gesture: NumberGesture, key: string): string | undefined {
		if (gesture === 'commit') return undefined;
		return key;
	}

	function setSize(value: number, gesture: NumberGesture): void {
		ctx.textFormat.applyPatch(fontSizeValuePatch(value), 'Font size', coalesce(gesture, 'size'));
	}

	function lineHeightNumber(): number | null {
		const height = lineHeight.value;
		if (height === null || height.unit === 'AUTO') return null;
		return height.value;
	}

	function lineHeightUnit(): 'PIXELS' | 'PERCENT' {
		const height = lineHeight.value;
		if (height === null || height.unit === 'AUTO') return 'PERCENT';
		return height.unit;
	}

	function setLineHeight(value: number, gesture: NumberGesture): void {
		const patch = lineHeightValuePatch({ value, unit: lineHeightUnit() });
		ctx.textFormat.applyPatch(patch, 'Line height', coalesce(gesture, 'line-height'));
	}

	function toggleLineHeightUnit(): void {
		const unit = lineHeightUnit() === 'PIXELS' ? 'PERCENT' : 'PIXELS';
		const current = lineHeightNumber();
		let value = 100;
		if (unit === 'PIXELS') value = Math.round((size.value === null ? 16 : size.value) * 1.2);
		if (current !== null && size.value !== null) {
			value = unit === 'PIXELS' ? (current / 100) * size.value : (current / size.value) * 100;
		}
		const rounded = Math.round(value * 100) / 100;
		ctx.textFormat.applyPatch(lineHeightValuePatch({ value: rounded, unit }), 'Line height unit');
	}

	function letterSpacingUnit(): 'PIXELS' | 'PERCENT' {
		const spacing = letterSpacing.value;
		if (spacing === null) return 'PERCENT';
		return spacing.unit;
	}

	function setLetterSpacing(value: number, gesture: NumberGesture): void {
		const patch = letterSpacingValuePatch({ value, unit: letterSpacingUnit() });
		ctx.textFormat.applyPatch(patch, 'Letter spacing', coalesce(gesture, 'letter-spacing'));
	}

	function toggleLetterSpacingUnit(): void {
		const unit = letterSpacingUnit() === 'PIXELS' ? 'PERCENT' : 'PIXELS';
		ctx.textFormat.applyPatch(letterSpacingValuePatch({ value: 0, unit }), 'Letter spacing unit');
	}

	// ---------- alignment, decoration, case, lists ----------

	const horizontal = $derived(sharedValue(paragraphs, (paragraph: Paragraph) => paragraph.align));
	const listKind = $derived(sharedValue(paragraphs, (paragraph: Paragraph) => paragraph.list));
	const vertical = $derived(sharedValue(textNodes, (node) => node.textAlignVertical));
	const decoration = $derived(shown(style.textDecoration));
	const textCase = $derived(shown(style.textCase));

	const HORIZONTAL_OPTIONS = [
		{ value: 'LEFT', label: 'Align left', icon: TextAlignLeftIcon },
		{ value: 'CENTER', label: 'Align center', icon: TextAlignCenterIcon },
		{ value: 'RIGHT', label: 'Align right', icon: TextAlignRightIcon },
		{ value: 'JUSTIFIED', label: 'Justify', icon: TextAlignJustifyIcon }
	];
	const VERTICAL_OPTIONS = [
		{ value: 'TOP', label: 'Align top', icon: AlignTopIcon },
		{ value: 'CENTER', label: 'Align middle', icon: AlignCenterVerticalIcon },
		{ value: 'BOTTOM', label: 'Align bottom', icon: AlignBottomIcon }
	];
	const CASE_OPTIONS = [
		{ value: 'ORIGINAL', label: 'Aa', title: 'Original case' },
		{ value: 'UPPER', label: 'AG', title: 'Uppercase' },
		{ value: 'LOWER', label: 'ag', title: 'Lowercase' },
		{ value: 'TITLE', label: 'Ag', title: 'Title case' }
	];
	const RESIZE_OPTIONS = [
		{ value: 'WIDTH_AND_HEIGHT', label: 'Auto width', icon: ArrowsHorizontalIcon },
		{ value: 'HEIGHT', label: 'Auto height', icon: ArrowsVerticalIcon },
		{ value: 'NONE', label: 'Fixed size', icon: MinusIcon }
	];
	const resize = $derived(sharedValue(textNodes, (node) => node.textAutoResize));

	function setDecoration(next: TextStyle['textDecoration']): void {
		const active = decoration.value === next;
		const target = active ? 'NONE' : next;
		ctx.textFormat.applyPatch(decorationValuePatch(target), 'Text decoration');
	}

	function setCase(next: string): void {
		if (next !== 'ORIGINAL' && next !== 'UPPER' && next !== 'LOWER' && next !== 'TITLE') return;
		ctx.textFormat.applyPatch(textCasePatch(next), 'Text case');
	}

	function setHorizontal(next: string): void {
		if (next !== 'LEFT' && next !== 'CENTER' && next !== 'RIGHT' && next !== 'JUSTIFIED') return;
		ctx.textFormat.setAlignment(next);
	}

	// ---------- text node settings ----------

	function setNodeProps(
		label: string,
		props: Partial<TextNode>,
		gesture: NumberGesture = 'commit'
	): void {
		setSelectionProps(ctx, { label, mergeKey: `inspector:text:${label}`, gesture }, (node) => {
			if (node.type !== 'TEXT') return {};
			return props;
		});
	}

	function setVertical(next: string): void {
		if (next !== 'TOP' && next !== 'CENTER' && next !== 'BOTTOM') return;
		setNodeProps('Vertical alignment', { textAlignVertical: next });
	}

	function setResize(next: string): void {
		if (next !== 'WIDTH_AND_HEIGHT' && next !== 'HEIGHT' && next !== 'NONE') return;
		setNodeProps('Text resize', { textAutoResize: next });
	}

	const truncation = $derived(sharedValue(textNodes, (node) => node.textTruncation));
	const maxLines = $derived(sharedValue(textNodes, (node) => node.maxLines));
	const leadingTrim = $derived(sharedValue(textNodes, (node) => node.leadingTrim));
	const spacingAfter = $derived(sharedValue(paragraphs, (paragraph) => paragraph.spacingAfter));
	const indent = $derived(sharedValue(paragraphs, (paragraph) => paragraph.indent));
	const features = $derived(shown(style.openTypeFeatures));

	function featureOn(tag: string, defaultOn: boolean): boolean {
		const set = features.value;
		if (set === null || set[tag] === undefined) return defaultOn;
		return set[tag];
	}
</script>

{#snippet unitButton(name: string, unit: 'PIXELS' | 'PERCENT', toggle: () => void)}
	<button
		type="button"
		aria-label={name}
		title={name}
		class="text-faint hover:text-default px-1 text-xs"
		onclick={toggle}
	>
		{unit === 'PERCENT' ? '%' : 'px'}
	</button>
{/snippet}

<div class="flex flex-col gap-2 px-3 pb-3" data-typography-section>
	<div class="min-w-0">
		<FontFamilyPicker {families} value={family} mixed={font.mixed} {missing} onchange={setFamily} />
	</div>

	<div class="grid grid-cols-[1fr_4.5rem] gap-1">
		<div class="min-w-0" data-font-style>
			<DropdownField
				options={styleOptions}
				value={fontStyle}
				mixed={font.mixed}
				onchange={setStyle}
			/>
		</div>
		<NumberField
			label="Aa"
			name="Font size"
			min={1}
			max={1000}
			scrub={false}
			value={size.value}
			mixed={size.mixed}
			onchange={setSize}
		/>
	</div>

	<div class="grid grid-cols-2 gap-1">
		<NumberField
			label="↕"
			name="Line height"
			min={0}
			placeholder="Auto"
			value={lineHeightNumber()}
			mixed={lineHeight.mixed}
			onclear={() => ctx.textFormat.applyPatch(lineHeightValuePatch(null), 'Line height')}
			onchange={setLineHeight}
		>
			{#snippet trailing()}
				{@render unitButton('Line height unit', lineHeightUnit(), toggleLineHeightUnit)}
			{/snippet}
		</NumberField>
		<NumberField
			label="↔"
			name="Letter spacing"
			step={0.1}
			value={letterSpacing.value === null ? null : letterSpacing.value.value}
			mixed={letterSpacing.mixed}
			onchange={setLetterSpacing}
		>
			{#snippet trailing()}
				{@render unitButton('Letter spacing unit', letterSpacingUnit(), toggleLetterSpacingUnit)}
			{/snippet}
		</NumberField>
	</div>

	<div class="flex items-center justify-between gap-1">
		<ToggleGroup
			name="Text align"
			options={HORIZONTAL_OPTIONS}
			value={horizontal.value}
			mixed={horizontal.mixed}
			onchange={setHorizontal}
		/>
		<ToggleGroup
			name="Vertical align"
			options={VERTICAL_OPTIONS}
			value={vertical.value}
			mixed={vertical.mixed}
			onchange={setVertical}
		/>
	</div>

	<div class="flex items-center gap-1">
		<div class="min-w-0 flex-1">
			<ToggleGroup
				name="Text resize"
				options={RESIZE_OPTIONS}
				value={resize.value}
				mixed={resize.mixed}
				onchange={setResize}
			/>
		</div>
		<IconToggleButton
			icon={SlidersHorizontalIcon}
			label="Type settings"
			pressed={settingsAnchor !== null}
			onclick={toggleSettings}
		/>
	</div>

	{#if settingsAnchor !== null}
		<Popover
			anchor={settingsAnchor}
			label="Type settings"
			width={232}
			onclose={() => (settingsAnchor = null)}
		>
			<div class="flex flex-col gap-2 p-3" data-type-settings>
				<span class="text-default text-xs font-medium">Type settings</span>
				<div class="flex items-center gap-1">
					<IconToggleButton
						icon={TextUnderlineIcon}
						label="Underline"
						pressed={decoration.value === 'UNDERLINE'}
						onclick={() => setDecoration('UNDERLINE')}
					/>
					<IconToggleButton
						icon={TextStrikethroughIcon}
						label="Strikethrough"
						pressed={decoration.value === 'STRIKETHROUGH'}
						onclick={() => setDecoration('STRIKETHROUGH')}
					/>
					<IconToggleButton
						icon={ListBulletsIcon}
						label="Bulleted list"
						pressed={listKind.value === 'UNORDERED'}
						onclick={() => ctx.textFormat.toggleList('UNORDERED')}
					/>
					<IconToggleButton
						icon={ListNumbersIcon}
						label="Numbered list"
						pressed={listKind.value === 'ORDERED'}
						onclick={() => ctx.textFormat.toggleList('ORDERED')}
					/>
				</div>
				<ToggleGroup
					name="Text case"
					options={CASE_OPTIONS}
					value={textCase.value}
					mixed={textCase.mixed}
					onchange={setCase}
				/>
				<div class="grid grid-cols-2 gap-1">
					<NumberField
						label="¶"
						name="Paragraph spacing"
						min={0}
						value={spacingAfter.value}
						mixed={spacingAfter.mixed}
						onchange={(value) =>
							ctx.textFormat.setParagraphProps({ spacingAfter: value }, 'Paragraph spacing')}
					/>
					<NumberField
						label="→"
						name="Paragraph indent"
						min={0}
						value={indent.value}
						mixed={indent.mixed}
						onchange={(value) =>
							ctx.textFormat.setParagraphProps({ indent: value }, 'Paragraph indent')}
					/>
				</div>
				<label class="text-muted flex items-center justify-between text-xs">
					Truncate text
					<input
						type="checkbox"
						aria-label="Truncate text"
						checked={truncation.value === 'ENDING'}
						onchange={(event) =>
							setNodeProps('Truncation', {
								textTruncation: event.currentTarget.checked ? 'ENDING' : 'DISABLED',
								maxLines: event.currentTarget.checked ? maxLines.value : null
							})}
					/>
				</label>
				{#if truncation.value === 'ENDING'}
					<NumberField
						label="≡"
						name="Max lines"
						min={1}
						precision={0}
						placeholder="Auto"
						value={maxLines.value}
						mixed={maxLines.mixed}
						onclear={() => setNodeProps('Max lines', { maxLines: null })}
						onchange={(value, gesture) => setNodeProps('Max lines', { maxLines: value }, gesture)}
					/>
				{/if}
				<label class="text-muted flex items-center justify-between text-xs">
					Trim to cap height
					<input
						type="checkbox"
						aria-label="Trim to cap height"
						checked={leadingTrim.value === 'CAP_HEIGHT'}
						onchange={(event) =>
							setNodeProps('Leading trim', {
								leadingTrim: event.currentTarget.checked ? 'CAP_HEIGHT' : 'NONE'
							})}
					/>
				</label>
				{#each OPEN_TYPE_FEATURES as feature (feature.tag)}
					<label class="text-muted flex items-center justify-between text-xs">
						{feature.label}
						<input
							type="checkbox"
							aria-label={feature.label}
							checked={featureOn(feature.tag, feature.defaultOn)}
							onchange={(event) =>
								ctx.textFormat.applyPatch(
									openTypeFeaturePatch(feature.tag, event.currentTarget.checked),
									feature.label
								)}
						/>
					</label>
				{/each}
			</div>
		</Popover>
	{/if}
</div>
