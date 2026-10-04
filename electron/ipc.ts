import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
	return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowIpc(): void {
	ipcMain.handle('window:minimize', (event) => {
		senderWindow(event)?.minimize();
	});

	ipcMain.handle('window:toggleMaximize', (event) => {
		const window = senderWindow(event);
		if (!window) return false;
		if (window.isMaximized()) {
			window.unmaximize();
		} else {
			window.maximize();
		}
		return window.isMaximized();
	});

	ipcMain.handle('window:close', (event) => {
		senderWindow(event)?.close();
	});
}
