// A Chromium of its own for the experiments, on a virtual X display, so runs never touch the
// user's cursor or windows. It uses a copy of the user's Chromium cookies to stay logged in to
// Figma; the copy lives outside the repo and is refreshed with `browser start --refresh-login`.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { listTargets } from '../lib/cdp';
import {
	displayEnvironment,
	GEOMETRY,
	isRunning,
	openViewer,
	startVirtualDisplay,
	stopVirtualDisplay
} from '../lib/virtualDisplay';
import { isFigmaFile } from './targets/figmaFile';

const labDirectory = path.join(homedir(), '.cache/figma-lab');
const profileDirectory = path.join(labDirectory, 'profile');
const sessionPath = path.join(labDirectory, 'session.json');
const userProfile = path.join(homedir(), '.config/chromium');

// Everything Figma needs to recognise the login; the rest of the 800 MB profile stays behind.
const LOGIN_FILES = [
	'Local State',
	'Default/Cookies',
	'Default/Network/Cookies',
	'Default/Preferences'
];

const LAB_PORT = 9223;

export interface BrowserSession {
	display: string;
	displayPid: number;
	chromiumPid: number;
	port: number;
	url: string;
}

export function readBrowserSession(): BrowserSession | null {
	if (!existsSync(sessionPath)) return null;
	const session: BrowserSession = JSON.parse(readFileSync(sessionPath, 'utf8'));
	if (!isRunning(session.chromiumPid)) return null;
	return session;
}

export interface StartOptions {
	url: string;
	refreshLogin: boolean;
	viewer: boolean;
}

export async function startBrowser(options: StartOptions): Promise<BrowserSession> {
	const running = readBrowserSession();
	if (running) return running;
	if (options.refreshLogin || !existsSync(path.join(profileDirectory, 'Local State'))) {
		copyLogin();
	}
	const virtual = await startVirtualDisplay();
	if (!virtual) throw new Error('no virtual display: install tigervnc (Xvnc) or xorg-server-xvfb');
	const chromium = spawn(
		'chromium',
		[
			`--user-data-dir=${profileDirectory}`,
			`--remote-debugging-port=${LAB_PORT}`,
			`--window-size=${GEOMETRY.width},${GEOMETRY.height}`,
			'--window-position=0,0',
			// No GPU on the virtual display: WebGL (which Figma requires) runs on SwiftShader.
			'--use-angle=swiftshader',
			'--enable-unsafe-swiftshader',
			'--ignore-gpu-blocklist',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-session-crashed-bubble',
			'--hide-crash-restore-bubble',
			options.url
		],
		{
			stdio: 'ignore',
			detached: true,
			env: { ...process.env, ...displayEnvironment(virtual.display), WAYLAND_DISPLAY: '' }
		}
	);
	chromium.unref();
	if (!chromium.pid) throw new Error('chromium did not start');
	const session: BrowserSession = {
		display: virtual.display,
		displayPid: virtual.pid,
		chromiumPid: chromium.pid,
		port: LAB_PORT,
		url: options.url
	};
	writeFileSync(sessionPath, JSON.stringify(session, null, '\t'));
	await waitForFigma(session);
	if (options.viewer) openViewer(virtual);
	return session;
}

export function stopBrowser(): boolean {
	if (!existsSync(sessionPath)) return false;
	const session: BrowserSession = JSON.parse(readFileSync(sessionPath, 'utf8'));
	try {
		process.kill(-session.chromiumPid, 'SIGTERM');
	} catch {
		// Already gone.
	}
	stopVirtualDisplay(session.display, session.displayPid);
	rmSync(sessionPath, { force: true });
	return true;
}

function copyLogin(): void {
	mkdirSync(path.join(profileDirectory, 'Default/Network'), { recursive: true });
	let copied = 0;
	for (const relative of LOGIN_FILES) {
		const source = path.join(userProfile, relative);
		if (!existsSync(source)) continue;
		copyFileSync(source, path.join(profileDirectory, relative));
		copied += 1;
	}
	if (copied === 0) throw new Error(`no Chromium profile at ${userProfile} to copy the login from`);
}

// The editor is ready once the plugin API exists in a figma.com/design tab.
async function waitForFigma(session: BrowserSession): Promise<void> {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const ready = await hasFigmaTab(session.port);
		if (ready) return;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(
		'Figma did not open in the lab browser within 90 s (logged out? try --refresh-login, or watch with vncviewer)'
	);
}

async function hasFigmaTab(port: number): Promise<boolean> {
	try {
		const targets = await listTargets(port);
		return targets.some(isFigmaFile);
	} catch {
		return false;
	}
}
