<script lang="ts">
	import { onMount } from "svelte";
	import UserPlus from "lucide-svelte/icons/user-plus";
	import MessageCircle from "lucide-svelte/icons/message-circle";
	import Lock from "lucide-svelte/icons/lock";
	import Contact from "./Contact.svelte";
	import { createGun, getUser } from "$lib/gun/Gun.svelte";

	let friends = $state<{alias: string,avatar?: string, pub: string}[]>([]);

	onMount(() => {
		const user = getUser();

		if (!user.is) return;

		const gun = createGun();
		const chain = user.get<Record<string, string>>("friends").map();

		chain.on(async (_, k) => {
			await navigator.locks.request("CHAT_FRIENDS_SIDEBAR", async () => {
				if(friends.find((v) => v.pub === k)) return;

				const peer = await gun.get<{ alias: string, avatar?: string }>(`~${k}`).then();

				if(!peer) return;

				friends.push({
					alias: peer.alias ?? k,
					avatar: peer.avatar,
					pub: k
				})
			})
		})

		return () => {
			try {
				chain.off();
			} catch {
				// no-op
			}
		};
	})
</script>

<aside class="flex h-full w-60 shrink-0 flex-col border-r border-black/40 bg-panel max-md:w-16">
	<header class="flex h-12 shrink-0 items-center border-b border-black/20 px-3 max-md:hidden">
		<span class="text-[13px] font-semibold text-ink">Messages</span>
	</header>

	<div class="p-2">
		<a
			href="/friend-requests"
			title="Add friends"
			aria-label="Add friends"
			class="flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink max-md:justify-center"
		>
			<UserPlus class="h-4 w-4 shrink-0" />
			<span class="max-md:hidden">Add friends</span>
		</a>
	</div>

	<div class="flex min-h-0 flex-1 flex-col">
		<div class="flex items-center justify-between px-3 pb-1 pt-2">
			<span class="text-[11px] font-semibold uppercase tracking-wider text-ink-muted max-md:hidden">
				Direct Messages
			</span>
			<span class="text-[11px] font-medium text-ink-muted max-md:hidden">{friends.length}</span>
		</div>

		<nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
			{#if friends.length === 0}
				<div class="mx-1 mt-2 rounded-lg border border-dashed border-white/10 px-3 py-6 text-center max-md:hidden">
					<MessageCircle class="mx-auto h-6 w-6 text-ink-muted/60" />
					<p class="mt-2 text-xs text-ink-muted">No conversations yet.</p>
					<a href="/friend-requests" class="mt-2 inline-block text-xs font-medium text-blurple hover:underline">
						Add a friend
					</a>
				</div>
			{:else}
				{#each friends as friend}
					<Contact alias={friend.alias} avatar={friend.avatar} pub={friend.pub} />
				{/each}
			{/if}
		</nav>
	</div>

	<div class="shrink-0 border-t border-black/20 px-3 py-3 max-md:hidden">
		<p class="flex items-center gap-1.5 text-[11px] text-ink-muted">
			<Lock class="h-3 w-3" />
			End-to-end encrypted
		</p>
	</div>
</aside>
