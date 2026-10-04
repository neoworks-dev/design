import type { Context } from '@neoworks/extension-system';
import { VariablesService, VariablesState } from '../../lib/services/variables';

// The `variables` service: collections, modes, variables, bindings and the resolve step. Reads
// the document only through the `document` service and events: `document/change` invalidates the
// resolver cache, `document/before-apply` rejects alias cycles at write time.
export default {
	name: 'variables-core',
	inject: ['document'],
	apply(ctx: Context): void {
		const variables = new VariablesService(ctx, ctx.document, new VariablesState());

		ctx.on('document/before-apply', (changes, _meta, next) => {
			const result = next();
			variables.validate(result);
			return result;
		});
		ctx.on('document/change', (event) => variables.handleDocumentChange(event));
		ctx.on('document/replace', () => variables.handleDocumentReplace());
	}
};
