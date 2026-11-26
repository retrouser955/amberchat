<script lang="ts">
	import AuthGuard from "$lib/Components/AuthGuard/AuthGuard.svelte";

	let { children } = $props();
</script>

<AuthGuard>
	{@render children()}
</AuthGuard>
