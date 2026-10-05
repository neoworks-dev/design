import type { Context } from '@neoworks/extension-system';
import { ExportService } from '../../lib/services/export';

// Provides `export` (#125): per-node export settings as undoable document data, the export
// pipeline (area, scale, file names, de-duplication) and hand-off of the bytes to main. The file
// formats come from other plugins through `ctx.export.formats.register` (export-raster,
// export-svg, export-pdf); the UI is export-ui.
export default {
	name: 'export',
	inject: ['headlessRenderer', 'document', 'desktop'],
	apply(ctx: Context): void {
		new ExportService(ctx);
	}
};
