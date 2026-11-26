<script lang="ts">
	import { goto } from "$app/navigation";
	import { gunData } from "$lib/gun/Gun.svelte";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();

	$effect(() => {
		if (gunData.ready && !gunData.user) {
			goto("/");
		}
	});
</script>

{#if gunData.ready && gunData.user}
	{@render children()}
{:else}
	<div class="flex h-full w-full items-center justify-center bg-app text-sm text-ink-muted">
		<LoaderCircle class="mr-2 h-5 w-5 animate-spin text-blurple" />
		{gunData.ready ? "Redirecting to sign in…" : "Loading…"}
	</div>
{/if}
