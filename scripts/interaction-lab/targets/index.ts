import { isAppPage, type Target as CdpTarget } from '../../lib/cdp';
import { readSession } from '../../lib/session';
import { readBrowserSession } from '../browser';
import { readGpuSession, type GpuSession } from '../gpu';
import { isFigmaFile } from './figmaFile';
import { APP_PAGE_HELPERS, APP_READY } from './appPage';
import { FIGMA_PAGE_HELPERS, FIGMA_READY } from './figmaPage';

export { isFigmaFile };

let gpuLab = false;

/** Points both targets at the GPU lab (Hyprland headless output) instead of the virtual displays. */
export function useGpuLab(enabled: boolean): void {
	gpuLab = enabled;
}

function requireGpuSession(): GpuSession {
	const session = readGpuSession();
	if (!session) throw new Error('no GPU lab: run "bun run interactions gpu start"');
	return session;
}

export type TargetName = 'figma' | 'app';

export const TARGET_NAMES: TargetName[] = ['figma', 'app'];

/** Where an experiment runs: which CDP page, and the helpers that implement `__interactionLab`. */
export interface Target {
	name: TargetName;
	/** CDP port of the browser that shows this target. */
	port(): number;
	matches(target: CdpTarget): boolean;
	/** True once the page can install its helpers. */
	ready: string;
	helpers: string;
	/** How to get a session running, for error messages. */
	startHint: string;
}

const figma: Target = {
	name: 'figma',
	port: () => {
		if (gpuLab) return requireGpuSession().figmaPort;
		const configured = process.env.FIGMA_CDP_PORT;
		if (configured) return Number(configured);
		const session = readBrowserSession();
		if (session) return session.port;
		throw new Error('no Figma lab browser: run "bun run interactions browser start"');
	},
	matches: isFigmaFile,
	ready: FIGMA_READY,
	helpers: FIGMA_PAGE_HELPERS,
	startHint: 'bun run interactions browser start'
};

const app: Target = {
	name: 'app',
	port: () => {
		if (gpuLab) return requireGpuSession().appPort;
		const session = readSession();
		if (session) return session.cdpPort;
		throw new Error('no QA session of the app: run "bun run qa start --build"');
	},
	matches: isAppPage,
	ready: APP_READY,
	helpers: APP_PAGE_HELPERS,
	startHint: 'bun run qa start --build'
};

export function targetByName(name: string): Target {
	if (name === 'figma') return figma;
	if (name === 'app') return app;
	throw new Error(`unknown target "${name}" (figma, app)`);
}
