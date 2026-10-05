import type { Fiber } from '@neoworks/extension-system';

/**
 * Change a plugin's own settings: `fiber.update` restarts the plugin with the new config (and the
 * settings plugin stores it). Resolves once the plugin is running again.
 */
export async function updateConfig(fiber: Fiber, config: unknown): Promise<void> {
	fiber.update(config);
	await fiber.await();
}
