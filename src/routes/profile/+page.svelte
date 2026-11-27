<script lang="ts">
	import { onMount } from "svelte";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ImagePlus from "lucide-svelte/icons/image-plus";
	import Save from "lucide-svelte/icons/save";
	import Trash2 from "lucide-svelte/icons/trash-2";
	import { Button } from "$lib/Components/ui/button";
	import { Input } from "$lib/Components/ui/input";
	import { Label } from "$lib/Components/ui/label";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import { fileToAvatarDataUrl } from "$lib/avatar";
	import {
		ensureUserLogged,
		getUser,
		gunData,
		updateGunUser
	} from "$lib/gun/Gun.svelte";
	import { displayNameOf, PROFILE_LIMITS } from "$lib/profile";

	let displayName = $state("");
	let bio = $state("");
	let avatar = $state<string | undefined>();
	let busy = $state(false);
	let error = $state<string>();
	let success = $state<string>();

	const pub = $derived(gunData.user?.pub ?? "");

	onMount(() => {
		void (async () => {
			try {
				const user = getUser();
				ensureUserLogged(user);

				const [storedDisplayName, storedBio, storedAvatar] = await Promise.all([
					user.get<string>("displayName").then(),
					user.get<string>("bio").then(),
					user.get<string>("avatar").then()
				]);

				displayName = storedDisplayName ?? "";
				bio = storedBio ?? "";
				avatar = storedAvatar ?? undefined;
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		})();
	});

	async function handleFile(event: Event) {
		error = undefined;
		success = undefined;

		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		try {
			avatar = await fileToAvatarDataUrl(file);
			success = "Avatar ready. Press Save to publish it.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			input.value = "";
		}
	}

	function removeAvatar() {
		avatar = undefined;
		success = "Avatar will be removed when you save.";
	}

	async function save() {
		if (!gunData.user) return;

		busy = true;
		error = undefined;
		success = undefined;

		try {
			const user = getUser();
			const nextDisplayName = displayName.trim();
			const nextBio = bio.trim();

			await user.get<string>("displayName").put(nextDisplayName).then();
			await user.get<string>("bio").put(nextBio).then();
			await user
				.get<string>("avatar")
				.put((avatar ?? null) as unknown as string)
				.then();

			updateGunUser({
				displayName: nextDisplayName || undefined,
				bio: nextBio || undefined,
				avatar
			});

			success = "Profile saved.";
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
			href="/chat"
			class="flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			<span class="max-sm:hidden">Back to messages</span>
		</a>
		<h1 class="ml-2 text-[15px] font-semibold text-ink">Profile</h1>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
		<div class="mx-auto w-full max-w-2xl space-y-6">
			<section class="rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<div class="flex items-center gap-2">
					<ImagePlus class="h-4 w-4 text-blurple" />
					<h2 class="text-sm font-semibold text-ink">Avatar</h2>
				</div>
				<p class="mt-1 text-sm text-ink-muted">
					Your avatar is only shown to friends. It is resized to
					{PROFILE_LIMITS.avatarSize}px before being stored.
				</p>

				<div class="mt-4 flex flex-wrap items-center gap-4">
					<GunAvatar {pub} avatarSource={avatar} class="h-24 w-24 rounded-full" />

					<div class="flex flex-col gap-2">
						<label class="cursor-pointer">
							<span
								class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
							>
								<ImagePlus class="h-4 w-4" />
								Choose image
							</span>
							<input
								type="file"
								accept="image/*"
								class="sr-only"
								onchange={handleFile}
							/>
						</label>

						{#if avatar}
							<Button variant="secondary" size="sm" onclick={removeAvatar}>
								<Trash2 class="h-4 w-4" />
								Remove avatar
							</Button>
						{/if}
					</div>
				</div>
			</section>

			<section class="space-y-4 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<div>
					<h2 class="text-sm font-semibold text-ink">Public profile</h2>
					<p class="mt-1 text-sm text-ink-muted">
						Your display name replaces your username wherever you appear. Your bio is
						public.
					</p>
				</div>

				<div class="grid gap-2">
					<Label for="display-name">Display name</Label>
					<Input
						id="display-name"
						class="h-10 border-black/30 bg-rail/60 dark:bg-rail/60"
						bind:value={displayName}
						maxlength={PROFILE_LIMITS.displayName}
						placeholder={displayNameOf(gunData.user)}
					/>
					<p class="text-right text-[11px] text-ink-muted">
						{displayName.length}/{PROFILE_LIMITS.displayName}
					</p>
				</div>

				<div class="grid gap-2">
					<Label for="bio">Bio</Label>
					<textarea
						id="bio"
						class="min-h-28 w-full resize-y rounded-md border border-black/30 bg-rail/60 px-3 py-2 text-sm text-ink shadow-xs outline-none placeholder:text-ink-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-rail/60"
						bind:value={bio}
						maxlength={PROFILE_LIMITS.bio}
						placeholder="A short note about you"
					></textarea>
					<p class="text-right text-[11px] text-ink-muted">
						{bio.length}/{PROFILE_LIMITS.bio}
					</p>
				</div>

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

				<div class="flex justify-end">
					<Button disabled={busy || !gunData.user} onclick={save}>
						<Save class="h-4 w-4" />
						{busy ? "Saving…" : "Save profile"}
					</Button>
				</div>
			</section>
		</div>
	</div>
</div>
