<script lang="ts">
	import Users from "lucide-svelte/icons/users";
	import { cn } from "$lib/utils";

	let {
		gid,
		avatar,
		class: className,
		iconClass = "h-1/2 w-1/2"
	}: {
		gid: string;
		avatar?: string;
		class?: string;
		iconClass?: string;
	} = $props();

	const hue = $derived(hashHue(gid));
	const background = $derived(
		`linear-gradient(135deg, hsl(${hue} 42% 38%), hsl(${(hue + 36) % 360} 44% 26%))`
	);

	function hashHue(value: string) {
		let hash = 0;

		for (let index = 0; index < value.length; index += 1) {
			hash = (hash * 31 + value.charCodeAt(index)) | 0;
		}

		return Math.abs(hash) % 360;
	}
</script>

{#if avatar}
	<img
		src={avatar}
		alt=""
		class={cn("shrink-0 rounded-full object-cover", className)}
	/>
{:else}
	<span
		class={cn(
			"flex shrink-0 items-center justify-center rounded-full text-white/90 ring-1 ring-white/10",
			className
		)}
		style:background={background}
		aria-hidden="true"
	>
		<Users class={iconClass} />
	</span>
{/if}
