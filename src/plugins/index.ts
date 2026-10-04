// The single manifest of built-in plugins. Order is stable but must not matter for correctness:
// plugins declare `inject` and activate when their providers appear.

import type { Plugin } from '@neoworks/extension-system';
import coreCommands from './core-commands';
import coreContextKeys from './core-context-keys';
import coreRegions from './core-regions';

export const builtinPlugins: Plugin[] = [coreRegions, coreContextKeys, coreCommands];
