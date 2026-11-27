<script lang="ts">
	import { Input } from "$lib/Components/ui/input";
	import { Button } from "$lib/Components/ui/button";
	import { acceptFriend, addFriend, createInvite } from "$lib/gun/User/User";
	import { onMount } from "svelte";
	import { fetchProfile, getUser } from "$lib/gun/Gun.svelte";
	import { displayNameOf } from "$lib/profile";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import UserPlus from "lucide-svelte/icons/user-plus";
	import Copy from "lucide-svelte/icons/copy";
	import Inbox from "lucide-svelte/icons/inbox";
	import Users from "lucide-svelte/icons/users";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";

	let inviteLink = $state<string>("");
	let frequestPub = $state<string[]>([]);
	let friendRequests = $state<{ pub: string, alias: string, displayName?: string }[]>([]);
	let errorMessage = $state<string>();

	$effect(() => {
		if(frequestPub.length === 0) return;

		for(const pub of frequestPub) {
			if(friendRequests.some((request) => request.pub === pub)) continue;

			;(async () => {
				try {
					const peer = await fetchProfile(pub);

					if(!frequestPub.includes(pub)) return;
					if(friendRequests.some((request) => request.pub === pub)) return;

					friendRequests.push({
						alias: peer?.alias ?? pub,
						displayName: peer?.displayName,
						pub
					})
				} catch (error) {
					console.error("Could not load friend request", pub, error);
				}
			})()
		}
	})

	onMount(() => {
		const user = getUser();

		if(!user.is) return;

		const chain = user.get<Record<string, string>>("fr").map();

		chain.on((v, k) => {
			if(!v) {
				frequestPub = frequestPub.filter((pub) => pub !== k);
				friendRequests = friendRequests.filter((request) => request.pub !== k);
				return;
			}

			if(frequestPub.includes(k)) return;
			frequestPub.push(k);
		})

		return () => {
			try {
				chain.off()
			} catch {
				// noop
			}
		};
	})

	async function requestFriend() {
		if(inviteLink.trim() === "") return;

		errorMessage = undefined;

		try {
			await addFriend(inviteLink);
			inviteLink = "";
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	async function acceptRequest(pub: string) {
		errorMessage = undefined;

		try {
			await acceptFriend(pub);
			frequestPub = frequestPub.filter((requestPub) => requestPub !== pub);
			friendRequests = friendRequests.filter((request) => request.pub !== pub);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	async function copyInvite() {
		errorMessage = undefined;

		try {
			const invite = await createInvite();
			await navigator.clipboard.writeText(invite);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-app">
	<header class="flex h-12 shrink-0 items-center gap-2 border-b border-black/20 px-4 shadow-[0_1px_0_rgba(0,0,0,0.2)] sm:px-6">
		<Users class="h-4 w-4 text-ink-muted" />
		<h1 class="text-[15px] font-semibold text-ink">Friends</h1>
		<span class="ml-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
			{friendRequests.length} pending
		</span>
		<a
			href="/chat"
			class="ml-auto flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			<span class="max-sm:hidden">Back to messages</span>
		</a>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
		<div class="mx-auto w-full max-w-3xl space-y-6">
			<section class="rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<div class="flex items-center gap-2">
					<UserPlus class="h-4 w-4 text-blurple" />
					<h2 class="text-sm font-semibold text-ink">Add a friend</h2>
				</div>
				<p class="mt-1 text-sm text-ink-muted">
					Paste an invite link to send a friend request, or copy your own link to share.
				</p>

				<div class="mt-4 flex flex-col gap-2 sm:flex-row">
					<Input
						class="h-10 flex-1 border-black/30 bg-rail/60 dark:bg-rail/60"
						bind:value={inviteLink}
						placeholder="amber://request_friend?..."
						aria-label="Friend invite link"
					/>
					<Button class="sm:w-auto" onclick={requestFriend}>
						Send request
					</Button>
					<Button variant="secondary" onclick={copyInvite}>
						<Copy class="h-4 w-4" />
						Copy my invite
					</Button>
				</div>

				{#if errorMessage}
					<p class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{errorMessage}
					</p>
				{/if}
			</section>

			<section>
				<div class="mb-2 flex items-center gap-2 px-1">
					<Inbox class="h-4 w-4 text-ink-muted" />
					<h2 class="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
						Pending requests
					</h2>
				</div>

				{#if friendRequests.length === 0}
					<div class="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center">
						<Inbox class="mx-auto h-6 w-6 text-ink-muted/60" />
						<p class="mt-2 text-sm text-ink-muted">No pending friend requests.</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each friendRequests as req}
							<div class="flex items-center gap-3 rounded-md bg-panel px-3 py-2.5 transition-colors hover:bg-hover">
								<GunAvatar pub={req.pub} class="h-9 w-9 shrink-0 rounded-full" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-ink">{displayNameOf(req)}</p>
									<p class="text-[11px] text-ink-muted">Incoming friend request</p>
								</div>
								<Button size="sm" onclick={() => acceptRequest(req.pub)}>
									Accept
								</Button>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	</div>
</div>
