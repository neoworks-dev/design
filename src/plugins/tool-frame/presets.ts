export interface FramePreset {
	id: string;
	name: string;
	width: number;
	height: number;
}

export interface FramePresetGroup {
	id: string;
	title: string;
	presets: FramePreset[];
}

export const FRAME_PRESET_GROUPS: FramePresetGroup[] = [
	{
		id: 'phone',
		title: 'Phone',
		presets: [
			{ id: 'iphone-16', name: 'iPhone 16', width: 393, height: 852 },
			{ id: 'android-compact', name: 'Android Compact', width: 412, height: 917 }
		]
	},
	{
		id: 'tablet',
		title: 'Tablet',
		presets: [
			{ id: 'ipad-mini', name: 'iPad mini 8.3', width: 744, height: 1133 },
			{ id: 'ipad-pro-11', name: 'iPad Pro 11', width: 834, height: 1194 }
		]
	},
	{
		id: 'desktop',
		title: 'Desktop',
		presets: [
			{ id: 'desktop', name: 'Desktop', width: 1440, height: 1024 },
			{ id: 'macbook-air', name: 'MacBook Air', width: 1280, height: 832 }
		]
	},
	{
		id: 'paper',
		title: 'Paper',
		presets: [
			{ id: 'a4', name: 'A4', width: 595, height: 842 },
			{ id: 'a5', name: 'A5', width: 420, height: 595 },
			{ id: 'letter', name: 'Letter', width: 612, height: 792 }
		]
	},
	{
		id: 'watch',
		title: 'Watch',
		presets: [{ id: 'apple-watch-45', name: 'Apple Watch 45mm', width: 198, height: 242 }]
	}
];
