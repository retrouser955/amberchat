<script lang="ts">
	import { page } from "$app/state";
	import AuthGuard from "$lib/Components/AuthGuard/AuthGuard.svelte";
	import Sidebar from "$lib/Components/Sidebar/Sidebar.svelte";

	let { children } = $props();
</script>
<AuthGuard>
	<div class="flex h-full min-h-0 w-full">
		<Sidebar />
		<main class="flex min-w-0 flex-1 flex-col">
			<!-- Recreate the page when switching between DM peers so DMChannel
			     is rebound to the new public key. -->
			{#key page.url.pathname}
				{@render children()}
			{/key}
		</main>
	</div>
</AuthGuard>
