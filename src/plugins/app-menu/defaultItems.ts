// The standard content of the menu bar. Items reference commands by id; the title and the
// accelerator come from the command and the keymap. A feature plugin may add more items to any
// of these menus, or extend the `app` menu with a menu of its own.

export interface BarMenu {
	/** Menu path items are registered under. */
	path: string;
	title: string;
}

export const BAR_MENUS: BarMenu[] = [
	{ path: 'app/file', title: 'File' },
	{ path: 'app/edit', title: 'Edit' },
	{ path: 'app/view', title: 'View' },
	{ path: 'app/object', title: 'Object' },
	{ path: 'app/plugins', title: 'Plugins' },
	{ path: 'app/help', title: 'Help' }
];

export interface DefaultItem {
	menu: string;
	/** A command id, or the title of a submenu item when `submenu` is set. */
	command?: string;
	title?: string;
	submenu?: string;
	group: string;
}

export const DEFAULT_ITEMS: DefaultItem[] = [
	{ menu: 'app/file', command: 'file.new', group: '1_file' },
	{ menu: 'app/file', command: 'file.open', group: '1_file' },
	{ menu: 'app/file', command: 'file.save', group: '2_save' },
	{ menu: 'app/file', command: 'file.saveAs', group: '2_save' },
	{ menu: 'app/file', command: 'file.rename', group: '2_save' },
	{ menu: 'app/file', command: 'titlebar.close', group: '9_window' },

	{ menu: 'app/edit', command: 'edit.undo', group: '1_history' },
	{ menu: 'app/edit', command: 'edit.redo', group: '1_history' },
	{ menu: 'app/edit', command: 'clipboard.cut', group: '2_clipboard' },
	{ menu: 'app/edit', command: 'clipboard.copy', group: '2_clipboard' },
	{ menu: 'app/edit', command: 'clipboard.paste', group: '2_clipboard' },
	{ menu: 'app/edit', command: 'clipboard.paste-in-place', group: '2_clipboard' },
	{ menu: 'app/edit', command: 'duplicate.duplicate', group: '3_edit' },
	{ menu: 'app/edit', command: 'node.delete', group: '3_edit' },
	{ menu: 'app/edit', command: 'selection.select-all', group: '4_select' },
	{ menu: 'app/edit', command: 'selection.invert', group: '4_select' },
	{ menu: 'app/edit', command: 'node.find', group: '5_find' },

	{ menu: 'app/view', command: 'panels.toggle-dev-mode', group: '7_mode' },

	{ menu: 'app/object', command: 'grouping.group', group: '1_group' },
	{ menu: 'app/object', command: 'grouping.ungroup', group: '1_group' },
	{ menu: 'app/object', command: 'grouping.frame-selection', group: '1_group' },
	{ menu: 'app/object', command: 'mask.toggle', group: '2_mask' },
	{ menu: 'app/object', title: 'Boolean groups', submenu: 'toolbar/boolean', group: '3_combine' },
	{ menu: 'app/object', title: 'Align and distribute', submenu: 'context/align', group: '4_align' },
	{ menu: 'app/object', command: 'node.toggle-lock', group: '5_state' },
	{ menu: 'app/object', command: 'node.toggle-visibility', group: '5_state' },

	{ menu: 'app/help', command: 'palette.toggle', group: '1_help' }
];
