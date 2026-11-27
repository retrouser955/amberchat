<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { env } from "$env/dynamic/public";
	import { onMount } from "svelte";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import Copy from "lucide-svelte/icons/copy";
	import LogOut from "lucide-svelte/icons/log-out";
	import RotateCw from "lucide-svelte/icons/rotate-cw";
	import Save from "lucide-svelte/icons/save";
	import UserMinus from "lucide-svelte/icons/user-minus";
	import UserPlus from "lucide-svelte/icons/user-plus";
	import { Button } from "$lib/Components/ui/button";
	import { Input } from "$lib/Components/ui/input";
	import { Label } from "$lib/Components/ui/label";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import GroupAvatar from "$lib/Components/GroupAvatar/GroupAvatar.svelte";
	import { fetchProfile, gunData } from "$lib/gun/Gun.svelte";
	import { canSeeAvatar, friendPubsList } from "$lib/gun/Friends.svelte";
	import {
		addMember,
		inviteLink,
		leaveGroup,
		loadGroupBackup,
		removeMember,
		rotateGroup,
		updateGroupMeta
	} from "$lib/gun/Group/Group";
	import type { GroupBackup } from "$lib/gun/Group/types";
	import { displayNameOf } from "$lib/profile";

	type MemberView = {
		pub: string;
		role: string;
		alias: string;
		displayName?: string;
		avatar?: string;
	};

	const gid = page.params.id!;

	let backup = $state<GroupBackup>();
	let members = $state<MemberView[]>([]);
	let candidates = $state<MemberView[]>([]);
	let name = $state("");
	let description = $state("");
	let invite = $state("");
	let loading = $state(true);
	let busy = $state(false);
	let error = $state<string>();
	let success = $state<string>();

	const selfPub = $derived(gunData.user?.pub ?? "");
	const isOwner = $derived(
		backup?.roster.members.find((member) => member.pub === selfPub)?.role === "owner"
	);

	function ownerOf(next: GroupBackup) {
		return next.roster.members.find((member) => member.role === "owner")?.pub ?? selfPub;
	}

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = undefined;

		try {
			const next = await loadGroupBackup(gid);
			if (!next) throw new Error("You are not a member of this group.");

			backup = next;
			name = next.name;
			description = next.description ?? "";
			invite = inviteLink(gid, ownerOf(next), next.currentEpoch);

			await loadMembers(next);
			await loadCandidates(next);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	async function loadMembers(next: GroupBackup) {
		const profiles = await Promise.all(
			next.roster.members.map(async (member) => {
				const profile = await fetchProfile(member.pub);
				return {
					pub: member.pub,
					role: member.role,
					alias: profile?.alias ?? member.pub,
					displayName: profile?.displayName,
					avatar: profile?.avatar
				} satisfies MemberView;
			})
		);

		members = profiles;
	}

	async function loadCandidates(next: GroupBackup) {
		const existing = new Set(next.roster.members.map((member) => member.pub));
		const pubs = friendPubsList().filter((pub) => !existing.has(pub));

		candidates = (
			await Promise.all(
				pubs.map(async (pub) => {
					const profile = await fetchProfile(pub);
					return {
						pub,
						role: "member",
						alias: profile?.alias ?? pub,
						displayName: profile?.displayName,
						avatar: profile?.avatar
					} satisfies MemberView;
				})
			)
		).filter((candidate) => candidate.pub);
	}

	async function saveMeta() {
		busy = true;
		error = undefined;
		success = undefined;

		try {
			const next = await updateGroupMeta(gid, { name, description });
			backup = next;
			success = "Group updated.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function copyInvite() {
		error = undefined;
		success = undefined;

		try {
			await navigator.clipboard.writeText(invite);
			success = "Invite link copied.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	async function add(pub: string) {
		busy = true;
		error = undefined;
		success = undefined;

		try {
			const link = await addMember(gid, pub);
			await load();
			invite = link;
			success = "Member added. Share the invite link with them.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function remove(pub: string) {
		if (!window.confirm("Remove this member and rotate the group key?")) return;

		busy = true;
		error = undefined;
		success = undefined;

		try {
			const next = await removeMember(gid, pub);
			backup = next;
			await loadMembers(next);
			await loadCandidates(next);
			invite = inviteLink(gid, ownerOf(next), next.currentEpoch);
			success = "Member removed. The group key was rotated.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function rotate() {
		if (!window.confirm("Rotate the group key? Old messages stay readable.")) return;

		busy = true;
		error = undefined;
		success = undefined;

		try {
			const next = await rotateGroup(gid);
			backup = next;
			invite = inviteLink(gid, ownerOf(next), next.currentEpoch);
			success = "Group key rotated.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function leave() {
		if (!window.confirm("Leave this group? This only removes it from your account.")) return;

		try {
			await leaveGroup(gid);
			goto("/chat");
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-app">
	<header
		class="flex h-12 shrink-0 items-center gap-2 border-b border-black/20 px-4 shadow-[0_1px_0_rgba(0,0,0,0.2)] sm:px-6"
	>
		<a
			href={`/groups/${gid}`}
			class="flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			<span class="max-sm:hidden">Back to group</span>
		</a>
		<h1 class="ml-2 text-[15px] font-semibold text-ink">Group settings</h1>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
		<div class="mx-auto w-full max-w-3xl space-y-6">
			{#if loading}
				<p class="text-sm text-ink-muted">Loading…</p>
			{:else if error && !backup}
				<p
					class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{error}
				</p>
			{:else if backup}
				<section class="space-y-3 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
					<div class="flex items-center gap-3">
						<GroupAvatar
							gid={gid}
							avatar={backup.avatar}
							class="h-12 w-12"
							iconClass="h-6 w-6"
						/>
						<div>
							<h2 class="text-sm font-semibold text-ink">Group</h2>
							<p class="text-xs text-ink-muted">{members.length} members</p>
						</div>
					</div>

					<div class="grid gap-2">
						<Label for="group-name">Name</Label>
						<Input
							id="group-name"
							class="h-10 border-black/30 bg-rail/60 dark:bg-rail/60"
							bind:value={name}
							maxlength={64}
							disabled={!isOwner}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="group-description">Description</Label>
						<textarea
							id="group-description"
							class="min-h-24 w-full resize-y rounded-md border border-black/30 bg-rail/60 px-3 py-2 text-sm text-ink shadow-xs outline-none placeholder:text-ink-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-rail/60"
							bind:value={description}
							maxlength={280}
							disabled={!isOwner}
							placeholder="What is this group about?"
						></textarea>
					</div>

					{#if isOwner}
						<div class="flex justify-end">
							<Button disabled={busy} onclick={saveMeta}>
								<Save class="h-4 w-4" />
								Save changes
							</Button>
						</div>
					{:else}
						<p class="text-xs text-ink-muted">Only the owner can edit group details.</p>
					{/if}
				</section>

				<section class="space-y-3 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
					<div class="flex items-center gap-2">
						<UserPlus class="h-4 w-4 text-blurple" />
						<h2 class="text-sm font-semibold text-ink">Invite link</h2>
					</div>
					<p class="text-sm text-ink-muted">
						Share this link with someone who is already friends with the group owner.
					</p>
					<div class="flex flex-col gap-2 sm:flex-row">
						<Input
							class="h-10 flex-1 border-black/30 bg-rail/60 font-mono text-xs dark:bg-rail/60"
							value={invite}
							readonly
							aria-label="Group invite link"
						/>
						<Button variant="secondary" onclick={copyInvite}>
							<Copy class="h-4 w-4" />
							Copy
						</Button>
					</div>
					<p class="text-[11px] text-ink-muted">
						Relay: {env.PUBLIC_GUN_RELAY ?? "http://localhost:3000/gun"}
					</p>
				</section>

				<section class="space-y-3 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
					<div class="flex items-center justify-between gap-2">
						<h2 class="text-sm font-semibold text-ink">Members</h2>
						<span class="text-xs text-ink-muted">{members.length}</span>
					</div>

					<div class="space-y-1.5">
						{#each members as member (member.pub)}
							<div class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
								<GunAvatar
									pub={member.pub}
									avatarSource={canSeeAvatar(member.pub) ? member.avatar : undefined}
									class="h-9 w-9 shrink-0 rounded-full"
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-ink">
										{displayNameOf(member)}
										{#if member.pub === selfPub}
											<span class="text-ink-muted">(you)</span>
										{/if}
									</p>
									<p class="truncate text-[11px] text-ink-muted">
										{member.role === "owner" ? "Owner" : "Member"}
									</p>
								</div>
								{#if isOwner && member.pub !== selfPub}
									<Button
										size="sm"
										variant="secondary"
										disabled={busy}
										onclick={() => remove(member.pub)}
									>
										<UserMinus class="h-4 w-4" />
										Remove
									</Button>
								{/if}
							</div>
						{/each}
					</div>

					{#if isOwner && candidates.length > 0}
						<div class="border-t border-white/5 pt-3">
							<p class="mb-2 text-xs font-medium text-ink-muted">Add a friend</p>
							<div class="space-y-1.5">
								{#each candidates as candidate (candidate.pub)}
									<div class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
										<GunAvatar
											pub={candidate.pub}
											avatarSource={canSeeAvatar(candidate.pub) ? candidate.avatar : undefined}
											class="h-8 w-8 shrink-0 rounded-full"
										/>
										<p class="min-w-0 flex-1 truncate text-sm text-ink-soft">
											{displayNameOf(candidate)}
										</p>
										<Button size="sm" disabled={busy} onclick={() => add(candidate.pub)}>
											<UserPlus class="h-4 w-4" />
											Add
										</Button>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</section>

				<section class="space-y-3 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
					<h2 class="text-sm font-semibold text-ink">Danger zone</h2>

					{#if isOwner}
						<div class="flex flex-wrap items-center gap-2">
							<Button variant="secondary" disabled={busy} onclick={rotate}>
								<RotateCw class="h-4 w-4" />
								Rotate key
							</Button>
							<Button variant="destructive" onclick={leave}>
								<LogOut class="h-4 w-4" />
								Leave group
							</Button>
						</div>
						<p class="text-xs text-ink-muted">
							Rotating the key does not revoke access to messages already sent. Removing a
							member rotates automatically.
						</p>
					{:else}
						<Button variant="destructive" onclick={leave}>
							<LogOut class="h-4 w-4" />
							Leave group
						</Button>
					{/if}
				</section>

				{#if error}
					<p
						class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{error}
					</p>
				{/if}

				{#if success}
					<p
						class="rounded-md border border-positive/30 bg-positive/10 px-3 py-2 text-sm text-positive"
					>
						{success}
					</p>
				{/if}
			{/if}
		</div>
	</div>
</div>
