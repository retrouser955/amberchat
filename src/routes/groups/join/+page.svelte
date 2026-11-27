<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount } from "svelte";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import LogIn from "lucide-svelte/icons/log-in";
	import { Button } from "$lib/Components/ui/button";
	import { Input } from "$lib/Components/ui/input";
	import { env } from "$env/dynamic/public";
	import { joinGroup } from "$lib/gun/Group/Group";
	import { groupCallManager } from "$lib/calls/GroupCallManager.svelte";

	let link = $state("");
	let busy = $state(false);
	let error = $state<string>();

	onMount(() => {
		const directLink = page.url.searchParams.get("link");

		if (directLink) {
			link = directLink;
			void join();
			return;
		}

		const gid = page.url.searchParams.get("gid");
		const from = page.url.searchParams.get("from");
		const epoch = page.url.searchParams.get("epoch");

		if (gid && from && epoch) {
			link = `amber://join_group?gid=${encodeURIComponent(gid)}&from=${encodeURIComponent(
				from
			)}&epoch=${encodeURIComponent(epoch)}`;
			void join();
		}
	});

	async function join() {
		if (!link.trim()) return;

		busy = true;
		error = undefined;

		try {
			const backup = await joinGroup(link);

			try {
				await groupCallManager.reload();
			} catch {
				// Joining succeeded; call subscriptions can catch up later.
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
		<h1 class="ml-2 text-[15px] font-semibold text-ink">Join group</h1>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
		<div class="mx-auto w-full max-w-2xl">
			<section class="rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<div class="flex items-center gap-2">
					<LogIn class="h-4 w-4 text-blurple" />
					<h2 class="text-sm font-semibold text-ink">Group invite</h2>
				</div>
				<p class="mt-1 text-sm text-ink-muted">
					Paste the invite link the group owner sent you. You must be friends with the
					owner.
				</p>

				<div class="mt-4 flex flex-col gap-2 sm:flex-row">
					<Input
						class="h-10 flex-1 border-black/30 bg-rail/60 dark:bg-rail/60"
						bind:value={link}
						placeholder="amber://join_group?gid=…"
						aria-label="Group invite link"
					/>
					<Button class="sm:w-auto" disabled={busy} onclick={join}>
						<LogIn class="h-4 w-4" />
						{busy ? "Joining…" : "Join"}
					</Button>
				</div>

				{#if error}
					<p
						class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{error}
					</p>
				{/if}

				<p class="mt-3 text-[11px] text-ink-muted">
					Relay: {env.PUBLIC_GUN_RELAY ?? "http://localhost:3000/gun"}
				</p>
			</section>
		</div>
	</div>
</div>
