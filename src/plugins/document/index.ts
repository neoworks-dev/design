import type { Context } from '@neoworks/extension-system';
import type { DesignDocument } from '../../lib/document';
import { DocumentService } from '../../lib/services/document';
import { DocumentState } from '../../lib/services/documentState.svelte';
import { registerPageCommands } from './pageCommands';

interface DocumentConfig {
	/** The document to start with; defaults to a blank one with a single page. */
	document?: DesignDocument;
}

// The `document` service: scene graph, the one `apply` mutation path, pages. Other services read
// the document through it and mutate only through `ctx.document.apply`.
export default {
	name: 'document',
	inject: ['commands'],
	apply(ctx: Context, config?: DocumentConfig): void {
		const state = new DocumentState();
		if (config && config.document) state.replace(config.document);
		const document = new DocumentService(ctx, state);
		registerPageCommands(ctx, document);
	}
};
