// A display for a debug run that is not the user's desktop.
//
// The window cannot simply stay hidden: an unmapped window has a hidden document, Chromium stops
// requestAnimationFrame and the CanvasKit surface never paints. So it needs a real display
// somewhere else. Xvnc (tigervnc) is preferred because a human can attach `vncviewer` and watch;
// Xvfb works as a fallback without watching.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

export const GEOMETRY = { width: 1440, height: 900, depth: 24 };

// Display numbers reserved for debug runs. Grove uses :90-:99, so stay clear of it.
const DISPLAY_RANGE = { first: 100, last: 109 };

export interface VirtualDisplay {
	display: string;
	pid: number;
	watchable: boolean;
}

interface SpawnedServer {
	child: ChildProcess;
	watchable: boolean;
}

// Starts a detached X server that outlives this process; stop it with `stopVirtualDisplay`.
export async function startVirtualDisplay(): Promise<VirtualDisplay | null> {
	reapAbandonedDisplays();

	const number = freeDisplayNumber();
	if (number === null) return null;

	const display = `:${number}`;
	const spawned = spawnDisplayServer(display);
	if (!spawned) return null;

	const ready = await waitForSocket(number);
	if (!ready) {
		spawned.child.kill('SIGKILL');
		return null;
	}
	spawned.child.unref();

	return { display, pid: spawned.child.pid ?? 0, watchable: spawned.watchable };
}

export function stopVirtualDisplay(display: string, pid: number): void {
	closeViewers(display);
	killQuietly(pid);
	const number = Number(display.replace(':', ''));
	if (Number.isInteger(number)) removeDisplayFiles(number);
}

// Xvnc only listens on loopback and needs no password: a debug display, not a remote desktop.
function spawnDisplayServer(display: string): SpawnedServer | null {
	if (hasCommand('Xvnc')) {
		const args = [
			display,
			'-geometry',
			`${GEOMETRY.width}x${GEOMETRY.height}`,
			'-depth',
			String(GEOMETRY.depth),
			'-SecurityTypes',
			'None',
			'-localhost',
			'-AlwaysShared'
		];
		return { child: spawnDetached('Xvnc', args), watchable: true };
	}
	if (hasCommand('Xvfb')) {
		const geometry = `${GEOMETRY.width}x${GEOMETRY.height}x${GEOMETRY.depth}`;
		const args = [display, '-screen', '0', geometry, '-nolisten', 'tcp'];
		return { child: spawnDetached('Xvfb', args), watchable: false };
	}
	return null;
}

// Opens a viewer on the user's desktop. Watching is optional; failure is ignored.
export function openViewer(virtual: VirtualDisplay): boolean {
	if (!virtual.watchable || !hasCommand('vncviewer')) return false;
	if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
	const viewer = spawn('vncviewer', [virtual.display], { stdio: 'ignore', detached: true });
	viewer.on('error', () => {});
	viewer.unref();
	return true;
}

export function closeViewers(display: string): void {
	spawnSync('pkill', ['-f', `^vncviewer ${display}$`], { stdio: 'ignore' });
}

// Environment that puts a child on `display`. Electron ignores DISPLAY on a Wayland session
// unless the platform hint and session type say X11.
export function displayEnvironment(display: string): Record<string, string> {
	return {
		DISPLAY: display,
		ELECTRON_OZONE_PLATFORM_HINT: 'x11',
		XDG_SESSION_TYPE: 'x11'
	};
}

export function hasCommand(command: string): boolean {
	const directories = (process.env.PATH || '').split(':');
	return directories.some((directory) => directory && existsSync(`${directory}/${command}`));
}

function spawnDetached(command: string, args: string[]): ChildProcess {
	const child = spawn(command, args, { stdio: 'ignore', detached: true });
	// Reported by the readiness check instead.
	child.on('error', () => {});
	return child;
}

function killQuietly(pid: number): void {
	if (pid <= 0) return;
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		// Already gone.
	}
}

// Killed runs leave lock and socket files behind that make a display look taken.
function reapAbandonedDisplays(): void {
	for (let number = DISPLAY_RANGE.first; number <= DISPLAY_RANGE.last; number += 1) {
		const owner = lockOwner(number);
		if (owner === null || isRunning(owner)) continue;
		removeDisplayFiles(number);
	}
}

function lockOwner(number: number): number | null {
	try {
		const pid = Number(readFileSync(lockPath(number), 'utf8').trim());
		if (!Number.isInteger(pid) || pid <= 0) return null;
		return pid;
	} catch {
		return null;
	}
}

export function isRunning(pid: number): boolean {
	if (pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function removeDisplayFiles(number: number): void {
	rmSync(lockPath(number), { force: true });
	rmSync(socketPath(number), { force: true });
}

function freeDisplayNumber(): number | null {
	for (let number = DISPLAY_RANGE.first; number <= DISPLAY_RANGE.last; number += 1) {
		if (!existsSync(socketPath(number)) && !existsSync(lockPath(number))) return number;
	}
	return null;
}

async function waitForSocket(number: number): Promise<boolean> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (existsSync(socketPath(number))) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

function socketPath(number: number): string {
	return `/tmp/.X11-unix/X${number}`;
}

function lockPath(number: number): string {
	return `/tmp/.X${number}-lock`;
}
