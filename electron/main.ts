import { app, BrowserWindow, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyDebugPaths, forwardRendererConsole, isQaSession } from './debug';
import { registerWindowIpc } from './ipc';
import { loadWindowState, trackWindowState } from './windowState';

// Compiled output lives in electron/dist, so the project root is two levels up.
const distDirectory = path.dirname(fileURLToPath(import.meta.url));
const buildDirectory = path.join(distDirectory, '../../build');
// Set by `bun run electron:dev`; NODE_ENV is avoided because bun build inlines it.
const devServerUrl = process.env.DEV_SERVER_URL;

app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
applyDebugPaths();

protocol.registerSchemesAsPrivileged([
	{
		scheme: 'app',
		privileges: { standard: true, secure: true, supportFetchAPI: true }
	}
]);

let mainWindow: BrowserWindow | null = null;

// The title bar is drawn by the renderer (titlebar plugin). macOS keeps its traffic lights over
// it; elsewhere the window is fully frameless and the plugin draws the controls.
const frameOptions: Electron.BrowserWindowConstructorOptions =
	process.platform === 'darwin'
		? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 13 } }
		: { frame: false };

function createWindow(): void {
	const state = loadWindowState();
	const window = new BrowserWindow({
		width: state.width,
		height: state.height,
		x: state.x,
		y: state.y,
		minWidth: 960,
		minHeight: 600,
		...frameOptions,
		backgroundColor: '#0b0b0d',
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(distDirectory, 'preload.cjs')
		}
	});
	mainWindow = window;
	forwardRendererConsole(window);
	trackWindowState(window);
	if (state.maximized) window.maximize();

	window.on('closed', () => {
		if (mainWindow === window) mainWindow = null;
	});

	// External links open in the user's browser, never inside the app.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
		return { action: 'deny' };
	});

	if (devServerUrl) {
		loadWithRetry(window, devServerUrl);
		if (!isQaSession) window.webContents.openDevTools({ mode: 'detach' });
		return;
	}
	void window.loadURL('app://design/');
}

// The vite dev server may still be booting when electron starts.
function loadWithRetry(window: BrowserWindow, url: string, attempt = 0): void {
	window.loadURL(url).catch(() => {
		if (attempt >= 30) return;
		setTimeout(() => loadWithRetry(window, url, attempt + 1), 500);
	});
}

function resolveBuildFile(pathname: string): string {
	const filePath = path.join(buildDirectory, pathname);
	if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
	return path.join(buildDirectory, '200.html');
}

function registerAppProtocol(): void {
	protocol.handle('app', (request) => {
		const { pathname } = new URL(request.url);
		return net.fetch(pathToFileURL(resolveBuildFile(pathname)).href);
	});
}

function focusMainWindow(): void {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', focusMainWindow);

	void app.whenReady().then(() => {
		registerWindowIpc();
		registerAppProtocol();
		createWindow();
	});
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
