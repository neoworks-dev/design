<script lang="ts">
	import { transformPoint } from '../../lib/document';
	import { isCollapsed, selectionRange } from '../../lib/text/editing';
	import { getKernel } from '../../lib/kernel/context';
	import { RICH_TEXT_MIME } from './service';

	// The visible half of text editing, drawn as DOM over the canvas until the overlay service
	// exists: selection rectangles, the caret, the IME composition underline, and the hidden
	// textarea that receives typing, IME composition and clipboard events. Everything is placed in
	// the node's local space under one CSS matrix, so rotation and zoom need no per-rect math.

	const ctx = getKernel();
	const edit = ctx.textEdit;
	const session = edit.state;

	const CARET_WIDTH_PX = 1.5;
	const MULTI_CLICK_MS = 450;
	const MULTI_CLICK_DISTANCE_PX = 4;

	let root = $state<HTMLDivElement>();
	let input = $state<HTMLTextAreaElement>();

	interface Rect {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface Geometry {
		matrix: string;
		scale: number;
		caret: Rect;
		caretScreen: { x: number; y: number };
		selection: Rect[];
		composition: Rect[];
	}

	function surfaceMatrix(id: string): {
		matrix: string;
		scale: number;
		project: (x: number, y: number) => { x: number; y: number };
	} {
		const absolute = ctx.document.absoluteTransform(id);
		const toScreen = (x: number, y: number): { x: number; y: number } => {
			const world = transformPoint(absolute, x, y);
			return ctx.viewport.worldToScreen(world);
		};
		const origin = toScreen(0, 0);
		const unitX = toScreen(1, 0);
		const unitY = toScreen(0, 1);
		const a = unitX.x - origin.x;
		const b = unitX.y - origin.y;
		const c = unitY.x - origin.x;
		const d = unitY.y - origin.y;
		return {
			matrix: `matrix(${a}, ${b}, ${c}, ${d}, ${origin.x}, ${origin.y})`,
			scale: Math.hypot(a, b) || 1,
			project: toScreen
		};
	}

	function measure(): Geometry | null {
		void session.activity;
		const id = session.nodeId;
		if (id === null) return null;
		const node = ctx.document.get(id);
		if (!node || node.type !== 'TEXT') return null;
		try {
			const surface = surfaceMatrix(id);
			const selection = session.selection;
			const caret = ctx.textLayout.caretRect(id, selection.focus);
			let selected: Rect[] = [];
			if (!isCollapsed(selection)) {
				selected = ctx.textLayout.rangeRectsOf(id, selectionRange(selection));
			}
			const composition = session.composition;
			let composing: Rect[] = [];
			if (composition) {
				const end = { ...composition.start, offset: composition.start.offset + composition.length };
				composing = ctx.textLayout.rangeRects(id, composition.start, end);
			}
			return {
				matrix: surface.matrix,
				scale: surface.scale,
				caret,
				caretScreen: surface.project(caret.x, caret.y),
				selection: selected,
				composition: composing
			};
		} catch {
			return null;
		}
	}

	const geometry = $derived(measure());

	$effect(() => {
		if (!input) return;
		input.focus({ preventScroll: true });
		edit.attachInput(input);
		return () => edit.attachInput(null);
	});

	// ---------- the hidden input ----------

	function onBeforeInput(event: InputEvent): void {
		if (event.isComposing) return;
		const handled = routeInput(event.inputType, event.data);
		if (handled) event.preventDefault();
	}

	function routeInput(inputType: string, data: string | null): boolean {
		if (inputType === 'insertText' || inputType === 'insertReplacementText') {
			if (data) edit.insertText(data);
			return true;
		}
		if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
			edit.insertParagraph();
			return true;
		}
		if (inputType === 'deleteContentBackward') return deleteWith(() => edit.deleteBackward());
		if (inputType === 'deleteWordBackward') return deleteWith(() => edit.deleteBackward('word'));
		if (inputType === 'deleteContentForward') return deleteWith(() => edit.deleteForward());
		if (inputType === 'deleteWordForward') return deleteWith(() => edit.deleteForward('word'));
		return inputType.startsWith('insertFromPaste') || inputType.startsWith('deleteByCut');
	}

	function deleteWith(run: () => void): boolean {
		run();
		return true;
	}

	function onCompositionStart(): void {
		edit.beginComposition();
	}

	function compositionText(event: CompositionEvent): string {
		if (typeof event.data === 'string') return event.data;
		return '';
	}

	function onCompositionUpdate(event: CompositionEvent): void {
		edit.updateComposition(compositionText(event));
	}

	function onCompositionEnd(event: CompositionEvent): void {
		edit.endComposition(compositionText(event));
		if (input) input.value = '';
	}

	function onCopy(event: ClipboardEvent): void {
		const payload = edit.copyPayload();
		if (payload === null || !event.clipboardData) return;
		event.clipboardData.setData('text/plain', payload.text);
		event.clipboardData.setData(RICH_TEXT_MIME, payload.rich);
		event.preventDefault();
	}

	function onCut(event: ClipboardEvent): void {
		const payload = edit.cutPayload();
		if (payload === null || !event.clipboardData) return;
		event.clipboardData.setData('text/plain', payload.text);
		event.clipboardData.setData(RICH_TEXT_MIME, payload.rich);
		event.preventDefault();
	}

	function onPaste(event: ClipboardEvent): void {
		event.preventDefault();
		const data = event.clipboardData;
		if (!data) return;
		edit.paste({ text: data.getData('text/plain'), rich: data.getData(RICH_TEXT_MIME) });
	}

	// ---------- pointer: caret placement and drag selection inside the edited text ----------

	let dragging = false;
	let lastPress = { time: 0, x: 0, y: 0, clicks: 0 };

	function countClicks(event: PointerEvent): number {
		const near =
			Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) <=
			MULTI_CLICK_DISTANCE_PX;
		const quick = event.timeStamp - lastPress.time <= MULTI_CLICK_MS;
		const clicks = near && quick ? lastPress.clicks + 1 : 1;
		lastPress = { time: event.timeStamp, x: event.clientX, y: event.clientY, clicks };
		return clicks;
	}

	function worldAt(event: PointerEvent): { x: number; y: number } | null {
		if (!root) return null;
		const box = root.getBoundingClientRect();
		return ctx.viewport.screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top });
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 || !(event.target instanceof Element)) return;
		if (!event.target.closest('[data-region="canvas"]')) return;
		const world = worldAt(event);
		if (!world) return;
		if (!edit.containsWorldPoint(world)) {
			edit.stop('commit');
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		edit.pointerAt(world, { extend: event.shiftKey, clicks: Math.min(countClicks(event), 3) });
		dragging = true;
		input?.focus({ preventScroll: true });
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragging) return;
		const world = worldAt(event);
		if (world) edit.dragTo(world);
	}

	function onPointerUp(): void {
		dragging = false;
	}

	// Capture phase, so the active tool never sees a press that belongs to the text being edited.
	$effect(() => {
		const dispose = ctx.effect(() => {
			window.addEventListener('pointerdown', onPointerDown, true);
			window.addEventListener('pointermove', onPointerMove, true);
			window.addEventListener('pointerup', onPointerUp, true);
			return () => {
				window.removeEventListener('pointerdown', onPointerDown, true);
				window.removeEventListener('pointermove', onPointerMove, true);
				window.removeEventListener('pointerup', onPointerUp, true);
			};
		}, 'text-edit/pointer');
		return () => {
			void dispose();
		};
	});
</script>

<div
	bind:this={root}
	class="pointer-events-none absolute inset-0 overflow-hidden"
	data-text-editor={session.nodeId}
>
	{#if geometry}
		<div class="absolute top-0 left-0 origin-top-left" style:transform={geometry.matrix}>
			{#each geometry.selection as rect, index (index)}
				<div
					class="bg-blue/30 absolute"
					data-text-selection
					style:left="{rect.x}px"
					style:top="{rect.y}px"
					style:width="{rect.width}px"
					style:height="{rect.height}px"
				></div>
			{/each}
			{#each geometry.composition as rect, index (index)}
				<div
					class="border-blue absolute"
					data-text-composition
					style:left="{rect.x}px"
					style:top="{rect.y}px"
					style:width="{rect.width}px"
					style:height="{rect.height}px"
					style:border-bottom-width="{1.5 / geometry.scale}px"
				></div>
			{/each}
			{#key session.activity}
				<div
					class="text-caret bg-blue absolute"
					data-text-caret
					style:left="{geometry.caret.x - CARET_WIDTH_PX / geometry.scale / 2}px"
					style:top="{geometry.caret.y}px"
					style:width="{CARET_WIDTH_PX / geometry.scale}px"
					style:height="{geometry.caret.height}px"
				></div>
			{/key}
		</div>
		<textarea
			bind:this={input}
			class="pointer-events-none absolute m-0 resize-none border-0 bg-transparent p-0 opacity-0 outline-none"
			aria-label="Text editor input"
			autocapitalize="off"
			autocomplete="off"
			spellcheck="false"
			data-text-input
			style:left="{geometry.caretScreen.x}px"
			style:top="{geometry.caretScreen.y}px"
			style:width="1px"
			style:height="{Math.max(geometry.caret.height * geometry.scale, 12)}px"
			onbeforeinput={onBeforeInput}
			oncompositionstart={onCompositionStart}
			oncompositionupdate={onCompositionUpdate}
			oncompositionend={onCompositionEnd}
			oncopy={onCopy}
			oncut={onCut}
			onpaste={onPaste}></textarea>
	{/if}
</div>

<style>
	.text-caret {
		animation: text-caret-blink 1.06s steps(1) infinite;
	}

	@keyframes text-caret-blink {
		0%,
		55% {
			opacity: 1;
		}
		56%,
		100% {
			opacity: 0;
		}
	}
</style>
