<script lang="ts">
	import { Button, Checkbox, Select } from '@neoworks-dev/ui';
	import { getKernel } from '../../lib/kernel/context';
	import type { SettingsResult, SettingsSection } from '../../lib/services/settings';
	import type { SettingField } from '../../lib/settings/fields';

	const ctx = getKernel();
	const settings = ctx.settings;

	const sections = $derived.by(() => {
		if (!settings.dialogOpen) return [];
		return settings.sections();
	});

	let selectedId = $state('core');
	let errors = $state<Record<string, string>>({});

	const selected = $derived.by(() => {
		const found = sections.find((section) => section.id === selectedId);
		if (found) return found;
		return sections[0];
	});

	function errorKey(section: SettingsSection, field: SettingField): string {
		return `${section.id}.${field.key}`;
	}

	function report(section: SettingsSection, field: SettingField, result: SettingsResult): void {
		const key = errorKey(section, field);
		const next = { ...errors };
		if (result.ok) delete next[key];
		else next[key] = result.message;
		errors = next;
	}

	function commit(section: SettingsSection, field: SettingField, value: unknown): void {
		report(section, field, settings.set(section.id, field.key, value));
	}

	function commitText(section: SettingsSection, field: SettingField, text: string): void {
		if (field.kind === 'text') {
			commit(section, field, text);
			return;
		}
		const parsed = Number(text);
		if (text.trim() === '' || Number.isNaN(parsed)) {
			errors = { ...errors, [errorKey(section, field)]: 'Enter a number.' };
			return;
		}
		commit(section, field, parsed);
	}

	function resetField(section: SettingsSection, field: SettingField): void {
		report(section, field, settings.reset(section.id, field.key));
	}

	function resetEverything(): void {
		settings.resetAll();
		errors = {};
	}

	function close(): void {
		errors = {};
		settings.closeDialog();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !settings.dialogOpen) return;
		event.stopPropagation();
		close();
	}

	function textOf(value: unknown): string {
		if (value === undefined) return '';
		return String(value);
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if settings.dialogOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="presentation"
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) close();
		}}
	>
		<div
			role="dialog"
			aria-label="Settings"
			data-settings-dialog
			class="bg-elevated border-line text-default flex h-[480px] w-[720px] max-w-[95vw] flex-col rounded-lg border shadow-lg"
		>
			<div class="border-line-faint flex h-11 shrink-0 items-center justify-between border-b px-4">
				<h2 class="text-sm font-semibold">Settings</h2>
				<Button size="sm" variant="ghost" onclick={close}>Close</Button>
			</div>
			<div class="flex min-h-0 flex-1">
				<nav
					class="border-line-faint w-44 shrink-0 overflow-y-auto border-r p-2"
					aria-label="Sections"
				>
					{#each sections as section (section.id)}
						<button
							type="button"
							class="hover:bg-raised w-full rounded px-2 py-1.5 text-left text-xs"
							class:bg-raised={selected?.id === section.id}
							aria-current={selected?.id === section.id}
							onclick={() => (selectedId = section.id)}
						>
							{section.title}
						</button>
					{/each}
				</nav>
				<div class="min-w-0 flex-1 overflow-y-auto p-4">
					{#if selected}
						<h3 class="mb-3 text-xs font-semibold">{selected.title}</h3>
						{#each selected.fields as field (field.key)}
							{@const value = settings.valueOf(selected, field)}
							{@const error = errors[errorKey(selected, field)]}
							<div
								class="border-line-faint flex flex-col gap-1 border-b py-3"
								data-setting={field.key}
							>
								<div class="flex items-center justify-between gap-3">
									<label class="text-xs" for="setting-{selected.id}-{field.key}"
										>{field.label}</label
									>
									<div class="flex items-center gap-2">
										{#if field.kind === 'boolean'}
											<Checkbox
												id="setting-{selected.id}-{field.key}"
												checked={value === true}
												onchange={(event: Event) => {
													if (event.currentTarget instanceof HTMLInputElement) {
														commit(selected, field, event.currentTarget.checked);
													}
												}}
											/>
										{:else if field.kind === 'choice' && field.options}
											<div class="w-32">
												<Select
													size="sm"
													value={textOf(value)}
													options={field.options.map((option) => ({
														value: option,
														label: option
													}))}
													onChange={(next) => {
														if (typeof next === 'string') commit(selected, field, next);
													}}
												/>
											</div>
										{:else}
											<input
												id="setting-{selected.id}-{field.key}"
												class="bg-input border-line text-default h-7 w-32 rounded border px-2 text-xs"
												class:border-red={error !== undefined}
												value={textOf(value)}
												inputmode={field.kind === 'number' ? 'decimal' : 'text'}
												onchange={(event) => commitText(selected, field, event.currentTarget.value)}
											/>
										{/if}
										<button
											type="button"
											class="text-muted hover:text-default text-xs disabled:opacity-30"
											disabled={!settings.isModified(selected, field)}
											aria-label="Reset {field.label}"
											onclick={() => resetField(selected, field)}
										>
											Reset
										</button>
									</div>
								</div>
								{#if field.description}
									<p class="text-muted text-xs">{field.description}</p>
								{/if}
								{#if error}
									<p class="text-red text-xs" role="alert">{error}</p>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</div>
			<div class="border-line-faint flex h-11 shrink-0 items-center justify-between border-t px-4">
				<span class="text-red text-xs" role="status">
					{#if settings.saveError}Could not save: {settings.saveError}{/if}
				</span>
				<Button size="sm" variant="surface" onclick={resetEverything}>Reset all to defaults</Button>
			</div>
		</div>
	</div>
{/if}
