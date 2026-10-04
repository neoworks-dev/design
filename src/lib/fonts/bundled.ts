// The fonts shipped with the app, so text always has something to draw with: Geist (sans) in the
// weights the UI uses and Geist Mono. They are the guaranteed fallback of `resolveFont`.
// Fontsource ships WOFF only, which Skia cannot read; the service converts to sfnt on load.

import geistSans400 from '@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff?url';
import geistSans500 from '@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff?url';
import geistSans600 from '@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff?url';
import geistSans700 from '@fontsource/geist-sans/files/geist-sans-latin-700-normal.woff?url';
import geistMono400 from '@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff?url';

export interface BundledFace {
	family: string;
	style: string;
	/** URL of the WOFF file inside the app bundle. */
	url: string;
}

export const FALLBACK_FAMILY = 'Geist';

export const BUNDLED_FACES: readonly BundledFace[] = [
	{ family: FALLBACK_FAMILY, style: 'Regular', url: geistSans400 },
	{ family: FALLBACK_FAMILY, style: 'Medium', url: geistSans500 },
	{ family: FALLBACK_FAMILY, style: 'SemiBold', url: geistSans600 },
	{ family: FALLBACK_FAMILY, style: 'Bold', url: geistSans700 },
	{ family: 'Geist Mono', style: 'Regular', url: geistMono400 }
];
