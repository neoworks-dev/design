// When the fixture scene is served. Mirrors the debug plugin's gating (plugins may not import
// each other): dev server, or a QA session started by `bun run qa` (`?qa=1`). A production build
// opened normally never shows fixture content.

export interface FixtureEnvironment {
	dev: boolean;
	/** `location.search`, for example `?qa=1`. */
	search: string;
}

export const QA_QUERY_PARAMETER = 'qa';

export function isFixtureEnabled(environment: FixtureEnvironment): boolean {
	if (environment.dev) return true;
	return new URLSearchParams(environment.search).get(QA_QUERY_PARAMETER) === '1';
}

export function currentEnvironment(): FixtureEnvironment {
	let search = '';
	if (typeof location !== 'undefined') search = location.search;
	return { dev: import.meta.env.DEV, search };
}
