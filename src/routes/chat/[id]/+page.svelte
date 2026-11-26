<script lang="ts">
	import { page } from "$app/state";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import Message from "$lib/Components/Message/Message.svelte";
	import { Input } from "$lib/Components/ui/input";
	import { createGun } from "$lib/gun/Gun.svelte";
	import { DMChannel } from "$lib/gun";
	import { onMount } from "svelte";
	import Lock from "lucide-svelte/icons/lock";
	import SendHorizontal from "lucide-svelte/icons/send-horizontal";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import Phone from "lucide-svelte/icons/phone";
	import Video from "lucide-svelte/icons/video";
	import { callManager } from "$lib/calls/CallManager.svelte";

	const uid = page.params.id!;
	const canCall = $derived(callManager.isFriend(uid));
	const callBusy = $derived(callManager.status !== "idle");

	let messageContent = $state<string>();
	let sendError = $state<string>();
	let loadError = $state<string>();
	let loading = $state(true);
	let userData = $state<{
		alias: string;
		avatar?: string;
	}>();

	let dm = new DMChannel(uid);
	let container: HTMLDivElement;

	$effect(() => {
		if (dm.messages.length === 0 || !container) return;

		container.scrollTo({
			top: container.scrollHeight,
			behavior: "smooth"
		});
	})

	async function sendMessage() {
		if (!messageContent || messageContent.trim() === "") return;

		sendError = undefined;

		try {
			await dm.send(messageContent);
			messageContent = "";
		} catch (error) {
			sendError = error instanceof Error ? error.message : String(error);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;

		e.preventDefault();
		void sendMessage();
	}

	onMount(() => {
		const gun = createGun();

		let off: (() => void) | undefined = undefined;
		let cancelled = false;

		(async () => {
			try {
				const data = await gun
					.get<{ alias?: string; avatar?: string }>(`~${uid}`)
					.then();

				if (!data) throw new Error("User not found");

				userData = {
					alias: data.alias ?? uid,
					avatar: data.avatar,
				};

				await dm.fetchUserEpub();

				if (cancelled) return;

				off = await dm.listen();
			} catch (error) {
				loadError = error instanceof Error ? error.message : String(error);
			} finally {
				loading = false;
			}
		})();

		return () => {
			cancelled = true;

			try {
				off?.();
			} catch {
				// no-op
			}
		};
	});
</script>

<div class="flex h-full min-h-0 flex-col bg-app">
	<header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-black/20 px-4 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
		<GunAvatar
			pub={uid}
			avatarSource={userData?.avatar}
			class="h-6 w-6 shrink-0 rounded-full"
		/>
		<p class="min-w-0 truncate text-[15px] font-semibold text-ink">
			{userData?.alias ?? "Direct message"}
		</p>
		<div class="ml-auto flex items-center gap-1">
			{#if canCall}
				<button
					type="button"
					title="Start voice call"
					aria-label="Start voice call"
					disabled={callBusy}
					class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => void callManager.startCall(uid, "audio")}
				>
					<Phone class="h-4 w-4" />
				</button>
				<button
					type="button"
					title="Start video call"
					aria-label="Start video call"
					disabled={callBusy}
					class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => void callManager.startCall(uid, "video")}
				>
					<Video class="h-4 w-4" />
				</button>
			{/if}
			<span class="ml-1 hidden items-center gap-1 text-[11px] font-medium text-ink-muted sm:flex">
				<Lock class="h-3 w-3" />
				Encrypted
			</span>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto py-4" bind:this={container}>
		{#if loadError}
			<div class="mx-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
				{loadError}
			</div>
		{:else if loading}
			<div class="flex h-full items-center justify-center text-sm text-ink-muted">
				<LoaderCircle class="mr-2 h-4 w-4 animate-spin text-blurple" />
				Loading messages…
			</div>
		{:else if dm.messages.length === 0}
			<div class="flex h-full flex-col items-center justify-center px-6 text-center">
				<GunAvatar
					pub={uid}
					avatarSource={userData?.avatar}
					class="mb-4 h-16 w-16 rounded-full"
				/>
				<p class="text-xl font-semibold text-ink">{userData?.alias ?? "Unknown user"}</p>
				<p class="mt-1 max-w-sm text-sm text-ink-muted">
					This is the beginning of your direct message history with {userData?.alias ?? "this user"}.
				</p>
			</div>
		{:else}
			{#each dm.messages as message, i}
				<Message
					alias={message.author.alias}
					avatar={message.author.avatar}
					content={message.content}
					timestamp={message.timestamp}
					pub={message.author.pub}
					compact={i > 0 &&
						dm.messages[i - 1].author.pub === message.author.pub &&
						message.timestamp - dm.messages[i - 1].timestamp < 5 * 60 * 1000}
				/>
			{/each}
		{/if}
	</div>

	<div class="shrink-0 px-4 pb-5 pt-1">
		{#if sendError}
			<p class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
				{sendError}
			</p>
		{/if}
		<div class="flex items-center gap-3 rounded-lg bg-elevated px-4 py-2.5">
			<Input
				class="h-7 min-h-0 flex-1 border-0 bg-transparent px-0 py-0 text-[15px] text-ink shadow-none placeholder:text-ink-muted focus-visible:ring-0 dark:bg-transparent"
				type="text"
				bind:value={messageContent}
				onkeydown={handleKeydown}
				placeholder={userData?.alias ? `Message @${userData.alias}` : "Message"}
				aria-label="Message"
			/>
			<button
				type="button"
				title="Send message"
				aria-label="Send message"
				disabled={!messageContent || messageContent.trim() === ""}
				class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-white/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
				onclick={() => void sendMessage()}
			>
				<SendHorizontal class="h-5 w-5" />
			</button>
		</div>
		<p class="mt-2 text-center text-[11px] text-ink-muted/70">
			<Lock class="mr-1 inline h-3 w-3" />
			Messages are end-to-end encrypted.
		</p>
	</div>
</div>
