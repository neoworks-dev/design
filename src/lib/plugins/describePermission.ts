import type { PluginPermission } from './manifest';

const DESCRIPTIONS: Record<PluginPermission, string> = {
	'document:read': 'Read the document',
	'document:write': 'Change the document',
	selection: 'See and change your selection',
	network: 'Use the network',
	fs: 'Read and write files',
	clipboard: 'Use the clipboard',
	ai: 'Offer tools to the AI',
	'ui:panel': 'Show panels and dialogs',
	'ui:tool': 'Add canvas tools',
	storage: 'Store data in the document'
};

/** A sentence fragment for a permission, as the permission prompt and the plugin manager show it. */
export function describePermission(permission: PluginPermission): string {
	return DESCRIPTIONS[permission];
}
