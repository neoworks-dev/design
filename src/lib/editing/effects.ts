// Effect list operations for the Design panel. Pure.

import type { BlurEffect, Effect, ShadowEffect } from '../document/types';

export type EffectType = Effect['type'];

export const EFFECT_TYPES: EffectType[] = [
	'DROP_SHADOW',
	'INNER_SHADOW',
	'LAYER_BLUR',
	'BACKGROUND_BLUR'
];

export const EFFECT_LABELS: Record<EffectType, string> = {
	DROP_SHADOW: 'Drop shadow',
	INNER_SHADOW: 'Inner shadow',
	LAYER_BLUR: 'Layer blur',
	BACKGROUND_BLUR: 'Background blur'
};

export function isShadow(effect: Effect): effect is ShadowEffect {
	return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW';
}

type BlurType = BlurEffect['type'];
type ShadowType = ShadowEffect['type'];

function isBlurType(type: EffectType): type is BlurType {
	return type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR';
}

function newBlur(type: BlurType): BlurEffect {
	return { type, visible: true, radius: 4, blurType: 'NORMAL' };
}

function newShadow(type: ShadowType): ShadowEffect {
	return {
		type,
		visible: true,
		color: { r: 0, g: 0, b: 0, a: 0.25 },
		offset: { x: 0, y: 4 },
		radius: 4,
		spread: 0,
		blendMode: 'NORMAL'
	};
}

/** What "+" adds: Figma's default drop shadow, or a blur of 4. */
export function newEffect(type: EffectType): Effect {
	if (isBlurType(type)) return newBlur(type);
	return newShadow(type);
}

/** Switch an effect to another type, keeping the radius (and shadow values where they fit). */
export function convertEffect(effect: Effect, type: EffectType): Effect {
	if (effect.type === type) return effect;
	if (isBlurType(type)) return { ...newBlur(type), visible: effect.visible, radius: effect.radius };
	if (isShadow(effect)) return { ...effect, type };
	return { ...newShadow(type), visible: effect.visible, radius: effect.radius };
}

/** Title-case label of a blend mode token (`COLOR_DODGE` is "Color dodge"). */
export function blendModeLabel(mode: string): string {
	if (mode === 'PASS_THROUGH') return 'Pass through';
	const words = mode.toLowerCase().split('_').join(' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}
