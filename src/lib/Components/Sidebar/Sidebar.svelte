<script lang="ts">
	import { onMount } from "svelte";
	import UserPlus from "lucide-svelte/icons/user-plus";
	import MessageCircle from "lucide-svelte/icons/message-circle";
	import Lock from "lucide-svelte/icons/lock";
	import Plus from "lucide-svelte/icons/plus";
	import Users from "lucide-svelte/icons/users";
	import Contact from "./Contact.svelte";
	import GroupContact from "./GroupContact.svelte";
	import { fetchProfile, getUser } from "$lib/gun/Gun.svelte";
	import { watchGroupBackups } from "$lib/gun/Group/Group";
	import type { GroupBackup } from "$lib/gun/Group/types";
	import { displayNameOf } from "$lib/profile";

	let friends = $state<{alias: string,avatar?: string, pub: string}[]>([]);
	let groups = $state<GroupBackup[]>([]);

	onMount(() => {
		const user = getUser();

		if (!user.is) return;

		const chain = user.get<Record<string, string>>("friends").map();

		chain.on(async (_, k) => {
			await navigator.locks.request("CHAT_FRIENDS_SIDEBAR", async () => {
				if(friends.find((v) => v.pub === k)) return;

				const peer = await fetchProfile(k);

				if(!peer) return;

				friends.push({
					alias: displayNameOf(peer),
					avatar: peer.avatar,
					pub: k
				})
			})
		})

		const offGroups = watchGroupBackups((next) => {
			groups = next;
		});

		return () => {
			try {
				chain.off();
			} catch {
				// no-op
			}

			offGroups();
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

	<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
		<div class="flex items-center justify-between px-1 pb-1 pt-2">
			<span class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted max-md:hidden">
				<Users class="h-3 w-3" />
				Groups
			</span>
			<a
				href="/groups/new"
				title="New group"
				aria-label="New group"
				class="rounded p-1 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
			>
				<Plus class="h-3.5 w-3.5" />
			</a>
		</div>

		{#if groups.length === 0}
			<a
				href="/groups/new"
				class="mx-1 mb-2 block rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-ink-muted transition-colors hover:border-white/20 hover:text-ink-soft max-md:hidden"
			>
				Create a group
			</a>
		{:else}
			<nav class="space-y-0.5 pb-2">
				{#each groups as group (group.gid)}
					<GroupContact gid={group.gid} name={group.name} avatar={group.avatar} />
				{/each}
			</nav>
		{/if}

		<div class="flex items-center justify-between px-1 pb-1 pt-3">
			<span class="text-[11px] font-semibold uppercase tracking-wider text-ink-muted max-md:hidden">
				Direct Messages
			</span>
			<span class="text-[11px] font-medium text-ink-muted max-md:hidden">{friends.length}</span>
		</div>

		{#if friends.length === 0}
			<div class="mx-1 mt-2 rounded-lg border border-dashed border-white/10 px-3 py-6 text-center max-md:hidden">
				<MessageCircle class="mx-auto h-6 w-6 text-ink-muted/60" />
				<p class="mt-2 text-xs text-ink-muted">No conversations yet.</p>
				<a href="/friend-requests" class="mt-2 inline-block text-xs font-medium text-blurple hover:underline">
					Add a friend
				</a>
			</div>
		{:else}
			<nav class="space-y-0.5">
				{#each friends as friend}
					<Contact alias={friend.alias} avatar={friend.avatar} pub={friend.pub} />
				{/each}
			</nav>
		{/if}
	</div>

	<div class="shrink-0 border-t border-black/20 px-3 py-3 max-md:hidden">
		<p class="flex items-center gap-1.5 text-[11px] text-ink-muted">
			<Lock class="h-3 w-3" />
			End-to-end encrypted
		</p>
	</div>
</aside>
