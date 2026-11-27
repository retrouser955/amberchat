<script lang="ts">
	import { goto } from "$app/navigation";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import Check from "lucide-svelte/icons/check";
	import Plus from "lucide-svelte/icons/plus";
	import Users from "lucide-svelte/icons/users";
	import { Button } from "$lib/Components/ui/button";
	import { Input } from "$lib/Components/ui/input";
	import { Label } from "$lib/Components/ui/label";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import { fetchProfile } from "$lib/gun/Gun.svelte";
	import { friendPubsList } from "$lib/gun/Friends.svelte";
	import { createGroup } from "$lib/gun/Group/Group";
	import { groupCallManager } from "$lib/calls/GroupCallManager.svelte";
	import { displayNameOf } from "$lib/profile";

	type FriendProfile = {
		pub: string;
		alias: string;
		displayName?: string;
		avatar?: string;
	};

	let name = $state("");
	let selected = $state<string[]>([]);
	let friends = $state<FriendProfile[]>([]);
	let busy = $state(false);
	let error = $state<string>();

	$effect(() => {
		const pubs = friendPubsList();
		const missing = pubs.filter((pub) => !friends.some((friend) => friend.pub === pub));

		if (missing.length === 0) return;

		void (async () => {
			const profiles = await Promise.all(missing.map((pub) => fetchProfile(pub)));
			const additions = profiles
				.filter((profile): profile is NonNullable<typeof profile> => !!profile)
				.map((profile) => ({
					pub: profile.pub,
					alias: profile.alias ?? profile.pub,
					displayName: profile.displayName,
					avatar: profile.avatar
				}));

			const next = additions.filter(
				(addition) => !friends.some((friend) => friend.pub === addition.pub)
			);

			if (next.length > 0) {
				friends = [...friends, ...next];
			}
		})();
	});

	function toggle(pub: string) {
		selected = selected.includes(pub)
			? selected.filter((entry) => entry !== pub)
			: [...selected, pub];
	}

	async function create() {
		busy = true;
		error = undefined;

		try {
			const backup = await createGroup(name, selected);

			try {
				await groupCallManager.reload();
			} catch {
				// Group creation succeeded; call subscriptions can catch up later.
			}

			goto(`/groups/${backup.gid}`);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-app">
	<header
		class="flex h-12 shrink-0 items-center gap-2 border-b border-black/20 px-4 shadow-[0_1px_0_rgba(0,0,0,0.2)] sm:px-6"
	>
		<a
			href="/groups"
			class="flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			<span class="max-sm:hidden">Groups</span>
		</a>
		<h1 class="ml-2 text-[15px] font-semibold text-ink">New group</h1>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
		<div class="mx-auto w-full max-w-2xl space-y-6">
			<section class="space-y-3 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<div class="flex items-center gap-2">
					<Users class="h-4 w-4 text-blurple" />
					<h2 class="text-sm font-semibold text-ink">Group details</h2>
				</div>

				<div class="grid gap-2">
					<Label for="group-name">Name</Label>
					<Input
						id="group-name"
						class="h-10 border-black/30 bg-rail/60 dark:bg-rail/60"
						bind:value={name}
						maxlength={64}
						placeholder="Weekend plans"
					/>
				</div>
			</section>

			<section class="rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-sm font-semibold text-ink">Members</h2>
					<span class="text-xs text-ink-muted">{selected.length} selected</span>
				</div>
				<p class="mt-1 text-sm text-ink-muted">Only friends can be added to a group.</p>

				{#if friends.length === 0}
					<div class="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
						<p class="text-sm text-ink-muted">You do not have any friends yet.</p>
						<Button href="/friend-requests" variant="secondary" size="sm" class="mt-3">
							Add friends
						</Button>
					</div>
				{:else}
					<div class="mt-4 space-y-1.5">
						{#each friends as friend (friend.pub)}
							<button
								type="button"
								class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
								onclick={() => toggle(friend.pub)}
							>
								<GunAvatar
									pub={friend.pub}
									avatarSource={friend.avatar}
									class="h-9 w-9 shrink-0 rounded-full"
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-ink">
										{displayNameOf(friend)}
									</p>
									<p class="truncate text-[11px] text-ink-muted">{friend.pub}</p>
								</div>
								<span
									class="flex h-5 w-5 items-center justify-center rounded-full border {selected.includes(
										friend.pub
									)
										? 'border-blurple bg-blurple text-white'
										: 'border-white/15 text-transparent'}"
								>
									<Check class="h-3.5 w-3.5" />
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			{#if error}
				<p
					class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{error}
				</p>
			{/if}

			<div class="flex justify-end">
				<Button disabled={busy} onclick={create}>
					<Plus class="h-4 w-4" />
					{busy ? "Creating…" : "Create group"}
				</Button>
			</div>
		</div>
	</div>
</div>
