import { Service, type Context } from '@neoworks/extension-system';
import { StoreSceneSource } from '../../lib/renderer/storeSceneSource';
import { buildFixtureDocument } from './fixture';

declare module '@neoworks/extension-system' {
	interface Context {
		'scene-fixture': SceneFixtureService;
	}
}

/**
 * Holds the fixture's SceneSource so QA scripts and tests can edit the scene while it renders:
 * `ctx['scene-fixture'].source.apply([...changes])`, `.source.showPage(id)`.
 */
export class SceneFixtureService extends Service {
	readonly source: StoreSceneSource;
	/** Stand-in selection for QA (`ctx['scene-fixture'].select([...])`); the viewport reads it. */
	private selected: string[] = [];

	constructor(ctx: Context) {
		super(ctx, 'scene-fixture');
		this.source = new StoreSceneSource(buildFixtureDocument());
	}

	selectedIds(): readonly string[] {
		return this.selected;
	}

	select(ids: string[]): void {
		this.selected = ids;
	}

	snapshotState(): { nodes: number; subscribers: number } {
		return {
			nodes: Object.keys(this.source.store.nodes).length,
			subscribers: this.source.listenerCount
		};
	}
}
