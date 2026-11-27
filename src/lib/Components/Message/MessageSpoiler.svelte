<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils";

	let { children }: { children: Snippet } = $props();

	let revealed = $state(false);

	function reveal() {
		revealed = true;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== "Enter" && event.key !== " ") return;

		event.preventDefault();
		reveal();
	}
</script>

<span
	role="button"
	tabindex="0"
	aria-label={revealed ? "Spoiler" : "Reveal spoiler"}
	class={cn(
		"cursor-pointer rounded-sm bg-elevated px-0.5 align-baseline transition-colors",
		!revealed && "select-none"
	)}
	onclick={reveal}
	onkeydown={handleKeydown}
>
	<span class={cn("transition-opacity", !revealed && "opacity-0")}>{@render children()}</span>
</span>
