<script lang="ts">
	import { page } from "$app/state";
	import GroupAvatar from "../GroupAvatar/GroupAvatar.svelte";
	import { cn } from "$lib/utils";

	const {
		gid,
		name,
		avatar
	}: {
		gid: string;
		name: string;
		avatar?: string;
	} = $props();

	const active = $derived(page.url.pathname === `/groups/${gid}`);
</script>

<a
	href={`/groups/${gid}`}
	title={name}
	aria-current={active ? "page" : undefined}
	class={cn(
		"group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors max-md:justify-center",
		active ? "bg-selected text-ink" : "text-ink-muted hover:bg-hover hover:text-ink-soft"
	)}
>
	<GroupAvatar {gid} {avatar} class="h-8 w-8" />
	<span class="min-w-0 truncate text-sm font-medium max-md:hidden">{name}</span>
</a>
