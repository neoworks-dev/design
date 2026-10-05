<script lang="ts">
	import { getKernel } from '../context';

	const name = getKernel().fiber.name;
</script>

<p data-plugin-name>{name}</p>
