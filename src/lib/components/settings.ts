// Per-component settings that have no field of their own in the document model: they live in the
// component's `pluginData` under the `components` plugin id (data-model.md section 1).

import type { Node } from '../document';

export const COMPONENT_NAMESPACE = 'components';

export interface ComponentSettings {
	documentationLink: string;
	/** Stored for the component; the layers panel does not act on it yet. */
	simplifyInstances: boolean;
}

export function readComponentSettings(node: Node): ComponentSettings {
	const own = node.pluginData[COMPONENT_NAMESPACE];
	const settings: ComponentSettings = { documentationLink: '', simplifyInstances: false };
	if (own === undefined) return settings;
	if (own.documentationLink !== undefined) settings.documentationLink = own.documentationLink;
	settings.simplifyInstances = own.simplifyInstances === 'true';
	return settings;
}
