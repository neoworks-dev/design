// The single manifest of built-in plugins. Order is stable but must not matter for correctness:
// plugins declare `inject` and activate when their providers appear.

import type { Plugin } from '@neoworks/extension-system';
import coreRegions from './core-regions';

export const builtinPlugins: Plugin[] = [coreRegions];
