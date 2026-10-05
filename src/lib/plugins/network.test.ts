import { describe, expect, it } from 'vitest';
import {
	normalizeAllowedDomain,
	parseHostsParameter,
	requireAllowedUrl,
	workerContentSecurityPolicy
} from './network';

describe('plugin network allowlist', () => {
	it('normalizes entries and rejects wildcards of everything', () => {
		expect(normalizeAllowedDomain('https://API.example.com/v1')).toBe('api.example.com');
		expect(normalizeAllowedDomain('*.example.com')).toBe('*.example.com');
		expect(normalizeAllowedDomain('*')).toBeNull();
		expect(normalizeAllowedDomain('exa mple.com')).toBeNull();
	});

	it('allows listed hosts and refuses the rest with a typed error', () => {
		const allowed = ['api.example.com', '*.cdn.test'];
		expect(requireAllowedUrl('https://api.example.com/x', allowed).hostname).toBe(
			'api.example.com'
		);
		expect(requireAllowedUrl('https://a.cdn.test/x', allowed).hostname).toBe('a.cdn.test');
		expect(() => requireAllowedUrl('https://evil.test/x', allowed)).toThrow(/not in the plugin/);
		expect(() => requireAllowedUrl('https://cdn.test/x', allowed)).toThrow(/not in the plugin/);
		expect(() => requireAllowedUrl('https://api.example.com.evil.test', allowed)).toThrow();
		expect(() => requireAllowedUrl('file:///etc/passwd', allowed)).toThrow(/only http/);
	});

	it('builds a policy that names only the allowed hosts', () => {
		expect(workerContentSecurityPolicy([])).toContain("connect-src 'none'");
		const policy = workerContentSecurityPolicy(['api.example.com']);
		expect(policy).toContain('connect-src https://api.example.com');
		expect(policy).toContain('script-src');
		expect(policy).not.toContain('evil');
	});

	it('reads the host list from a query parameter and drops junk', () => {
		expect(parseHostsParameter('a.com,*,b.com')).toEqual(['a.com', 'b.com']);
		expect(parseHostsParameter(null)).toEqual([]);
	});
});
