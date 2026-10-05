// Network access of plugins: which hosts a manifest's `networkAccess.allowedDomains` names, whether
// a URL falls under them, and the Content-Security-Policy that confines a plugin's worker to them.
// Pure; used by the renderer (worker creation, `network.fetch`) and by main (the protocol handler
// that serves the worker script, `plugins:fetch`).

/** An entry is `example.com`, `*.example.com` (subdomains, not the apex) or either with a scheme. */
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** The bare host pattern of an allowlist entry, or `null` when the entry is not a usable host. */
export function normalizeAllowedDomain(entry: string): string | null {
	let host = entry.trim().toLowerCase();
	const schemeEnd = host.indexOf('://');
	if (schemeEnd >= 0) host = host.slice(schemeEnd + 3);
	const pathStart = host.indexOf('/');
	if (pathStart >= 0) host = host.slice(0, pathStart);
	if (!HOST_PATTERN.test(host)) return null;
	return host;
}

export function normalizeAllowedDomains(entries: readonly string[]): string[] {
	const hosts: string[] = [];
	for (const entry of entries) {
		const host = normalizeAllowedDomain(entry);
		if (host !== null && !hosts.includes(host)) hosts.push(host);
	}
	return hosts;
}

function hostMatches(hostname: string, pattern: string): boolean {
	if (!pattern.startsWith('*.')) return hostname === pattern;
	return hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1;
}

export class NetworkAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NetworkAccessError';
	}
}

/** The URL when it is an http(s) URL whose host the allowlist names; throws a `NetworkAccessError` otherwise. */
export function requireAllowedUrl(rawUrl: string, allowedDomains: readonly string[]): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new NetworkAccessError(`"${rawUrl}" is not a valid URL`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new NetworkAccessError(`only http and https can be reached, not ${url.protocol}`);
	}
	const patterns = normalizeAllowedDomains(allowedDomains);
	if (patterns.some((pattern) => hostMatches(url.hostname, pattern))) return url;
	throw new NetworkAccessError(
		`${url.hostname} is not in the plugin's networkAccess.allowedDomains`
	);
}

/** Query parameters of the worker script URL that carry the allowlist to the protocol handler. */
export const WORKER_HOSTS_PARAMETER = 'pluginHosts';
export const WORKER_MARKER_PARAMETER = 'pluginWorker';

/**
 * The policy main sends with a plugin worker's script. The worker may run its own bundle and the
 * blob module the bootstrap loads, and talk to nothing but the allowed hosts: `import('https://x')`
 * and every other fetch of the worker are refused by the browser when `x` is not listed.
 */
export function workerContentSecurityPolicy(allowedDomains: readonly string[]): string {
	const hosts = normalizeAllowedDomains(allowedDomains);
	const remote = hosts.map((host) => `https://${host}`).join(' ');
	const scripts = ["'self'", 'app://design', 'blob:', remote].filter((part) => part !== '');
	let connections = "'none'";
	if (remote !== '') connections = remote;
	return [
		"default-src 'none'",
		`script-src ${scripts.join(' ')}`,
		`connect-src ${connections}`
	].join('; ');
}

export function parseHostsParameter(value: string | null): string[] {
	if (value === null || value === '') return [];
	return normalizeAllowedDomains(value.split(','));
}
