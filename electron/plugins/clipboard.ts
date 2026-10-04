// main-clipboard: the OS clipboard over `clipboard:*`.
//
// The renderer writes one `ClipboardWrite` (text, html, png together) and reads the same kinds
// back. The design payload travels inside the html (see src/lib/editing/clipboardPayload.ts), so
// one atomic write carries the plain-text and PNG fallbacks too.

import type { Plugin } from '@neoworks/extension-system';
import { route } from '../kernel/route';

export const mainClipboardPlugin: Plugin.Object = {
	name: 'main-clipboard',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		route(ctx, 'clipboard:read', () => ctx.electron.clipboard.read());
		route(ctx, 'clipboard:write', (content) => ctx.electron.clipboard.write(content));
	}
};
