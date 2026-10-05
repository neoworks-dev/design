// Reactive settings of the Inspect panel's code view: language, unit and list/code toggle. Held by
// the `codegen` service in a plain field (a Service may not own runes itself).

import type { CodegenUnit } from './types';

export type InspectView = 'list' | 'code';

export class CodegenSettings {
	language = $state('css');
	unit = $state<CodegenUnit>('px');
	view = $state<InspectView>('list');
}
