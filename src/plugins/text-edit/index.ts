import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../../lib/document';
import { objectArguments } from '../../lib/editing/contribute';
import type { Point } from '../../lib/tools/protocol';
import type { DeleteUnit } from '../../lib/text/editing';
import TextEditorLayer from './TextEditorLayer.svelte';
import { TextEditService, type MoveRequest, type MoveUnit } from './service';
import { TextEditState } from './state.svelte';

const EDITING = 'textEditing && !textComposing && !textEditSuspended';

interface MoveBinding {
	key: string;
	unit: MoveUnit;
	direction: -1 | 1;
}

const MOVES: MoveBinding[] = [
	{ key: 'ArrowLeft', unit: 'character', direction: -1 },
	{ key: 'ArrowRight', unit: 'character', direction: 1 },
	{ key: 'Mod+ArrowLeft', unit: 'word', direction: -1 },
	{ key: 'Mod+ArrowRight', unit: 'word', direction: 1 },
	{ key: 'ArrowUp', unit: 'line', direction: -1 },
	{ key: 'ArrowDown', unit: 'line', direction: 1 },
	{ key: 'Home', unit: 'line-edge', direction: -1 },
	{ key: 'End', unit: 'line-edge', direction: 1 },
	{ key: 'Mod+Home', unit: 'document', direction: -1 },
	{ key: 'Mod+End', unit: 'document', direction: 1 }
];

interface DeleteBinding {
	key: string;
	unit: DeleteUnit;
	direction: -1 | 1;
}

const DELETES: DeleteBinding[] = [
	{ key: 'Backspace', unit: 'grapheme', direction: -1 },
	{ key: 'Delete', unit: 'grapheme', direction: 1 },
	{ key: 'Mod+Backspace', unit: 'word', direction: -1 },
	{ key: 'Mod+Delete', unit: 'word', direction: 1 }
];

function isPoint(value: unknown): value is Point {
	if (typeof value !== 'object' || value === null) return false;
	return typeof Reflect.get(value, 'x') === 'number' && typeof Reflect.get(value, 'y') === 'number';
}

/** The text node the command targets: its `id` argument, else the single selected text. */
function targetNode(ctx: Context, args: Record<string, unknown>): NodeId | undefined {
	if (typeof args.id === 'string') return args.id;
	const [only, ...others] = ctx.selection.ids;
	if (only === undefined || others.length > 0) return undefined;
	if (ctx.document.get(only)?.type !== 'TEXT') return undefined;
	return only;
}

function bind(ctx: Context, key: string, command: string, args?: unknown): void {
	ctx.effect(
		() => ctx.keymap.register({ key, command, args, scope: 'text-edit', when: EDITING }),
		`keymap ${command} ${key}`
	);
}

// In-canvas text editing: the editing session (`ctx.textEdit`), the keymap scope `text-edit`
// while it runs, and the visible layer (caret, selection, IME underline and the hidden input) in
// the `canvas-overlay` region. Other plugins start editing with the `text.edit` command:
// `{ id, point?, selectAll? }` (the move tool on double click, Enter on a selected text), and
// react to the kernel event `text-edit/stopped`. A plugin that puts its own field on screen while
// editing (the link prompt) sets the context key `textEditSuspended`, which mutes the editing keys. The layer is plain DOM until an overlay service
// exists to draw it.
export default {
	name: 'text-edit',
	inject: [
		'textLayout',
		'document',
		'history',
		'keymap',
		'contextKeys',
		'commands',
		'selection',
		'regions',
		'viewport'
	],
	apply(ctx: Context): void {
		const edit = new TextEditService(ctx, new TextEditState());

		ctx.on('document/change', (event) => edit.handleDocumentChange(event));
		ctx.on('document/replace', () => edit.stop('commit'));
		ctx.on('selection/change', () => edit.handleSelectionChange());
		ctx.on('renderer/need-frame', () => {
			if (edit.active) edit.state.activity += 1;
		});
		ctx.effect(() => () => edit.stop('commit'), 'text-edit/session end');

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'text-edit/layer',
					region: 'canvas-overlay',
					component: TextEditorLayer,
					when: () => edit.active
				}),
			'text-edit layer'
		);

		// The move tool asks for an editor on double-click of a selected text node.
		ctx.on('canvas/edit-request', (id, editor) => {
			if (editor === 'text') edit.start(id, { point: undefined, selectAll: false });
		});

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.edit',
					title: 'Edit text',
					run: (args) => {
						const options = objectArguments(args);
						const id = targetNode(ctx, options);
						if (id === undefined) return;
						edit.start(id, {
							point: isPoint(options.point) ? options.point : undefined,
							selectAll: options.selectAll === true
						});
					}
				}),
			'command text.edit'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Enter',
					command: 'text.edit',
					args: { selectAll: true },
					scope: 'global',
					when: "!textEditing && selectionCount == 1 && selectionKind == 'TEXT'"
				}),
			'keymap text.edit Enter'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.move',
					title: 'Move text caret',
					when: EDITING,
					run: (args) => {
						const options = objectArguments(args);
						edit.move({
							unit: options.unit as MoveUnit,
							direction: options.direction as MoveRequest['direction'],
							extend: options.extend === true
						});
					}
				}),
			'command text.move'
		);
		for (const move of MOVES) {
			const args = { unit: move.unit, direction: move.direction };
			bind(ctx, move.key, 'text.move', args);
			bind(ctx, `Shift+${move.key}`, 'text.move', { ...args, extend: true });
		}

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.delete',
					title: 'Delete text',
					when: EDITING,
					run: (args) => {
						const options = objectArguments(args);
						const unit = options.unit as DeleteUnit;
						if (options.direction === 1) edit.deleteForward(unit);
						else edit.deleteBackward(unit);
					}
				}),
			'command text.delete'
		);
		for (const entry of DELETES) {
			bind(ctx, entry.key, 'text.delete', { unit: entry.unit, direction: entry.direction });
		}

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.enter',
					title: 'Start a new paragraph',
					when: EDITING,
					run: () => edit.insertParagraph()
				}),
			'command text.enter'
		);
		bind(ctx, 'Enter', 'text.enter');
		bind(ctx, 'Shift+Enter', 'text.enter');

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.select-all',
					title: 'Select all text',
					when: EDITING,
					run: () => edit.selectEverything()
				}),
			'command text.select-all'
		);
		bind(ctx, 'Mod+A', 'text.select-all');

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.exit',
					title: 'Stop editing text',
					when: 'textEditing && !textEditSuspended',
					run: () => edit.stop('escape')
				}),
			'command text.exit'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Escape',
					command: 'text.exit',
					scope: 'text-edit',
					when: 'textEditing && !textEditSuspended'
				}),
			'keymap text.exit'
		);

		// While typing, the global shortcuts are muted; undo and redo must still work.
		bind(ctx, 'Mod+Z', 'edit.undo');
		bind(ctx, 'Mod+Shift+Z', 'edit.redo');
		if (ctx.keymap.platform !== 'darwin') bind(ctx, 'Ctrl+Y', 'edit.redo');
	}
};
