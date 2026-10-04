// Shape of the API the preload exposes on `window.desktop`. Shared by preload
// and renderer so both sides agree on the contract.
export interface DesktopBridge {
	window: {
		minimize(): Promise<void>;
		toggleMaximize(): Promise<boolean>;
		close(): Promise<void>;
	};
	system: {
		platform: NodeJS.Platform;
		arch: string;
	};
}
