<script lang="ts">
	import { getKernel } from '../context';

	const ctx = getKernel();
	// A component-level side effect that must be attached to the owning plugin's fiber.
	ctx.effect(() => () => undefined, 'component effect');
</script>

<p data-testid="owner">{ctx.fiber.name}</p>
