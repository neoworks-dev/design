// CPU profiles of a stage through the CDP Profiler: the raw .cpuprofile (open it in Chrome
// DevTools → Performance) plus the functions with the most self time, as text for reports.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CdpSession } from '../lib/cdp';

interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
	hitCount?: number;
}

interface CpuProfile {
	nodes: ProfileNode[];
	startTime: number;
	endTime: number;
	samples?: number[];
}

export interface Hotspot {
	name: string;
	location: string;
	selfMs: number;
	share: number;
}

export async function profileStage(
	cdp: CdpSession,
	directory: string,
	label: string,
	stage: () => Promise<void>
): Promise<Hotspot[]> {
	await cdp.send('Profiler.enable');
	await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
	await cdp.send('Profiler.start');
	try {
		await stage();
	} finally {
		const { profile } = await cdp.send<{ profile: CpuProfile }>('Profiler.stop');
		await cdp.send('Profiler.disable');
		const fileName = `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.cpuprofile`;
		writeFileSync(path.join(directory, fileName), JSON.stringify(profile));
		lastProfile = profile;
	}
	return hotspots(lastProfile);
}

let lastProfile: CpuProfile = { nodes: [], startTime: 0, endTime: 0 };

/** Self time per function (summed over all its call sites), largest first; idle excluded. */
export function hotspots(profile: CpuProfile, limit = 15): Hotspot[] {
	const totalSamples = profile.nodes.reduce((sum, node) => sum + (node.hitCount || 0), 0);
	if (totalSamples === 0) return [];
	const microsecondsPerSample = (profile.endTime - profile.startTime) / totalSamples;
	const byFunction = new Map<string, Hotspot>();
	for (const node of profile.nodes) {
		const hits = node.hitCount || 0;
		const frame = node.callFrame;
		if (hits === 0 || frame.functionName === '(idle)' || frame.functionName === '(program)')
			continue;
		const location = `${path.basename(frame.url) || '(native)'}:${frame.lineNumber + 1}`;
		const name = frame.functionName || '(anonymous)';
		const key = `${name} ${location}`;
		const existing = byFunction.get(key);
		const selfMs = (hits * microsecondsPerSample) / 1000;
		if (existing) existing.selfMs += selfMs;
		else byFunction.set(key, { name, location, selfMs, share: 0 });
	}
	const totalMs = (totalSamples * microsecondsPerSample) / 1000;
	return [...byFunction.values()]
		.sort((left, right) => right.selfMs - left.selfMs)
		.slice(0, limit)
		.map((hotspot) => ({
			...hotspot,
			selfMs: Math.round(hotspot.selfMs),
			share: Math.round((hotspot.selfMs / totalMs) * 100)
		}));
}
