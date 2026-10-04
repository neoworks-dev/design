import type { Context } from '@neoworks/extension-system';
import { currentEnvironment, isFixtureEnabled } from './enabled';
import { SceneFixtureService } from './service';

export interface SceneFixtureConfig {
	/** Overrides detection (tests). By default: dev server or a `?qa=1` QA session. */
	enabled?: boolean;
}

function isEnabled(config: SceneFixtureConfig | undefined): boolean {
	if (config && config.enabled !== undefined) return config.enabled;
	return isFixtureEnabled(currentEnvironment());
}

// Dev and QA only: serves a hand-built fixture document to the renderer until the document
// service exists. When it does, an adapter plugin implements SceneSource over `ctx.document`
// (see src/lib/renderer/sceneSource.ts) and this plugin is no longer needed for the real app.
export default {
	name: 'scene-fixture',
	inject: ['renderer'],
	apply(ctx: Context, config?: SceneFixtureConfig): void {
		if (!isEnabled(config)) return;
		const fixture = new SceneFixtureService(ctx);
		ctx.renderer.setSceneSource(fixture.source);
	}
};
