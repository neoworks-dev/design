import type { Context } from '@neoworks/extension-system';
import type { Paragraph } from '../../lib/document';
import LinkPrompt from './LinkPrompt.svelte';
import { TextFormatService, type StepDirection } from './service';
import { TextFormatState } from './state.svelte';

const EDITING = 'textEditing && !textComposing && !textEditSuspended';
const SELECTED_TEXT = "!textEditing && selectionKind == 'TEXT'";

interface FormatCommand {
	id: string;
	title: string;
	keys: string[];
	run: (format: TextFormatService) => void;
}

function step(
	direction: StepDirection,
	change: (format: TextFormatService, direction: StepDirection) => void
): (format: TextFormatService) => void {
	return (format) => change(format, direction);
}

function align(value: Paragraph['align']): (format: TextFormatService) => void {
	return (format) => format.setAlignment(value);
}

const COMMANDS: FormatCommand[] = [
	{ id: 'text.bold', title: 'Bold', keys: ['Mod+B'], run: (f) => f.toggleBold() },
	{ id: 'text.italic', title: 'Italic', keys: ['Mod+I'], run: (f) => f.toggleItalic() },
	{ id: 'text.underline', title: 'Underline', keys: ['Mod+U'], run: (f) => f.toggleUnderline() },
	{
		id: 'text.strikethrough',
		title: 'Strikethrough',
		keys: ['Mod+Shift+X'],
		run: (f) => f.toggleStrikethrough()
	},
	{
		id: 'text.list.ordered',
		title: 'Numbered list',
		keys: ['Mod+Shift+7'],
		run: (f) => f.toggleList('ORDERED')
	},
	{
		id: 'text.list.unordered',
		title: 'Bulleted list',
		keys: ['Mod+Shift+8'],
		run: (f) => f.toggleList('UNORDERED')
	},
	{ id: 'text.link', title: 'Add link', keys: ['Mod+K'], run: (f) => f.openLinkPrompt() },
	{ id: 'text.align.left', title: 'Align text left', keys: ['Mod+Alt+L'], run: align('LEFT') },
	{
		id: 'text.align.center',
		title: 'Align text center',
		keys: ['Mod+Alt+T'],
		run: align('CENTER')
	},
	{ id: 'text.align.right', title: 'Align text right', keys: ['Mod+Alt+R'], run: align('RIGHT') },
	{
		id: 'text.align.justify',
		title: 'Justify text',
		keys: ['Mod+Alt+J'],
		run: align('JUSTIFIED')
	},
	{
		id: 'text.font-size.increase',
		title: 'Increase font size',
		keys: ['Mod+Shift+.'],
		run: step(1, (f, d) => f.stepFontSize(d))
	},
	{
		id: 'text.font-size.decrease',
		title: 'Decrease font size',
		keys: ['Mod+Shift+,'],
		run: step(-1, (f, d) => f.stepFontSize(d))
	},
	{
		id: 'text.line-height.increase',
		title: 'Increase line height',
		keys: ['Alt+Shift+.'],
		run: step(1, (f, d) => f.stepLineHeight(d))
	},
	{
		id: 'text.line-height.decrease',
		title: 'Decrease line height',
		keys: ['Alt+Shift+,'],
		run: step(-1, (f, d) => f.stepLineHeight(d))
	},
	{
		id: 'text.weight.increase',
		title: 'Increase font weight',
		keys: ['Mod+Alt+.'],
		run: step(1, (f, d) => f.stepWeight(d))
	},
	{
		id: 'text.weight.decrease',
		title: 'Decrease font weight',
		keys: ['Mod+Alt+,'],
		run: step(-1, (f, d) => f.stepWeight(d))
	},
	{
		id: 'text.letter-spacing.increase',
		title: 'Increase letter spacing',
		keys: ['Alt+.'],
		run: step(1, (f, d) => f.stepLetterSpacing(d))
	},
	{
		id: 'text.letter-spacing.decrease',
		title: 'Decrease letter spacing',
		keys: ['Alt+,'],
		run: step(-1, (f, d) => f.stepLetterSpacing(d))
	}
];

// Keyboard formatting for text: applied to the selected range while editing, to every selected
// text node as a whole otherwise. Commands carry the same ids in both cases; the keymap binds
// them once in the `text-edit` scope and once globally for a selected text. The typography
// section reads `ctx.textFormat.style()`, where a property that differs across the target is
// `MIXED`.
export default {
	name: 'text-format',
	inject: ['textEdit', 'commands', 'keymap', 'contextKeys', 'selection', 'document', 'regions'],
	apply(ctx: Context): void {
		const format = new TextFormatService(ctx, new TextFormatState());

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'text-format/link-prompt',
					region: 'canvas-overlay',
					component: LinkPrompt,
					when: () => format.state.linkPrompt !== null
				}),
			'text-format link prompt'
		);
		ctx.effect(() => () => format.closeLinkPrompt(false), 'text-format/link prompt close');

		for (const command of COMMANDS) {
			ctx.effect(
				() =>
					ctx.commands.register({
						id: command.id,
						title: command.title,
						when: `${EDITING} || ${SELECTED_TEXT}`,
						run: () => command.run(format)
					}),
				`command ${command.id}`
			);
			for (const key of command.keys) {
				ctx.effect(
					() =>
						ctx.keymap.register({ key, command: command.id, scope: 'text-edit', when: EDITING }),
					`keymap ${command.id} ${key} (editing)`
				);
				ctx.effect(
					() =>
						ctx.keymap.register({
							key,
							command: command.id,
							scope: 'global',
							when: SELECTED_TEXT
						}),
					`keymap ${command.id} ${key} (selected text)`
				);
			}
		}

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.list.indent',
					title: 'Indent list item',
					when: EDITING,
					run: () => format.changeListLevel(1)
				}),
			'command text.list.indent'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'text.list.outdent',
					title: 'Outdent list item',
					when: EDITING,
					run: () => format.changeListLevel(-1)
				}),
			'command text.list.outdent'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Tab',
					command: 'text.list.indent',
					scope: 'text-edit',
					when: EDITING
				}),
			'keymap text.list.indent'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Shift+Tab',
					command: 'text.list.outdent',
					scope: 'text-edit',
					when: EDITING
				}),
			'keymap text.list.outdent'
		);
	}
};
