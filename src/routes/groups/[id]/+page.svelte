<script lang="ts">
	import { page } from "$app/state";
	import { onMount, tick } from "svelte";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import Message from "$lib/Components/Message/Message.svelte";
	import MessageActionSheet from "$lib/Components/Message/MessageActionSheet.svelte";
	import { Input } from "$lib/Components/ui/input";
	import { Button } from "$lib/Components/ui/button";
	import { gunData } from "$lib/gun/Gun.svelte";
	import { canSeeAvatar } from "$lib/gun/Friends.svelte";
	import { GroupChannel } from "$lib/gun/Group/GroupChannel.svelte";
	import type { GroupMessageFormatted, GroupReplyReference } from "$lib/gun/Group/types";
	import type { MessageFormatted } from "$lib/gun";
	import { groupCallManager } from "$lib/calls/GroupCallManager.svelte";
	import { callManager } from "$lib/calls/CallManager.svelte";
	import { displayNameOf } from "$lib/profile";
	import Lock from "lucide-svelte/icons/lock";
	import SendHorizontal from "lucide-svelte/icons/send-horizontal";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import Phone from "lucide-svelte/icons/phone";
	import Video from "lucide-svelte/icons/video";
	import Reply from "lucide-svelte/icons/reply";
	import Pencil from "lucide-svelte/icons/pencil";
	import Check from "lucide-svelte/icons/check";
	import X from "lucide-svelte/icons/x";
	import Settings from "lucide-svelte/icons/settings";
	import Users from "lucide-svelte/icons/users";

	const gid = page.params.id!;

	let channel = $state<GroupChannel>();
	let loading = $state(true);
	let loadError = $state<string>();
	let loadOlderBusy = $state(false);

	let messageContent = $state("");
	let sendError = $state<string>();
	let replyTarget = $state<GroupMessageFormatted>();
	let editingMessage = $state<GroupMessageFormatted>();
	let actionSheetMessage = $state<GroupMessageFormatted>();
	let draftBeforeEdit = $state("");
	let highlightedMessage = $state<string>();
	let composerInput = $state<HTMLInputElement | null>(null);

	let container: HTMLDivElement;

	const title = $derived(channel?.meta?.name ?? "Group");
	const memberCount = $derived(channel?.roster?.members.length ?? 0);
	const canCall = $derived(!!channel && !channel.removed);
	const callBusy = $derived(
		groupCallManager.status !== "idle" || callManager.status !== "idle"
	);

	const sendDisabled = $derived(
		!messageContent ||
			messageContent.trim() === "" ||
			(!!editingMessage && messageContent === editingMessage.content) ||
			!!channel?.removed
	);

	let lastNewestTimestamp: number | undefined;

	$effect(() => {
		if (!channel || channel.messages.length === 0 || !container) return;

		const newest = channel.messages[channel.messages.length - 1]?.timestamp;
		if (!newest || newest === lastNewestTimestamp) return;

		lastNewestTimestamp = newest;
		container.scrollTo({
			top: container.scrollHeight,
			behavior: "smooth"
		});
	});

	onMount(() => {
		let off: (() => void) | undefined;
		let cancelled = false;

		(async () => {
			try {
				const opened = await GroupChannel.open(gid);
				if (cancelled) return;

				channel = opened;
				off = await opened.listen();
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

	function messageKey(message: GroupMessageFormatted) {
		return `${message.author.pub}:${message.timestamp}`;
	}

	function messageElementId(message: { from: string; id: number }) {
		return `group-message-${message.from}-${message.id}`;
	}

	function canEdit(message: GroupMessageFormatted) {
		return message.author.pub === gunData.user?.pub;
	}

	async function focusComposer() {
		await tick();
		composerInput?.focus();
	}

	function startReply(message: GroupMessageFormatted) {
		if (editingMessage) {
			messageContent = draftBeforeEdit;
			draftBeforeEdit = "";
			editingMessage = undefined;
		}

		replyTarget = message;
		void focusComposer();
	}

	function startEdit(message: GroupMessageFormatted) {
		if (!canEdit(message)) return;

		if (!editingMessage) {
			draftBeforeEdit = messageContent;
		}

		replyTarget = undefined;
		editingMessage = message;
		messageContent = message.content;
		void focusComposer();
	}

	function cancelReply() {
		replyTarget = undefined;
	}

	function cancelEdit() {
		editingMessage = undefined;
		messageContent = draftBeforeEdit;
		draftBeforeEdit = "";
		void focusComposer();
	}

	function openActions(message: GroupMessageFormatted) {
		actionSheetMessage = message;
	}

	function closeActions() {
		actionSheetMessage = undefined;
	}

	function replyFromSheet(message: MessageFormatted) {
		startReply(message as GroupMessageFormatted);
	}

	function editFromSheet(message: MessageFormatted) {
		startEdit(message as GroupMessageFormatted);
	}

	function jumpToReply(reference: GroupReplyReference) {
		const target = channel?.messages.find(
			(message) =>
				message.author.pub === reference.from && message.timestamp === reference.id
		);

		if (!target) return;

		const element = document.getElementById(messageElementId(reference));
		element?.scrollIntoView({ behavior: "smooth", block: "center" });

		const key = `${reference.from}:${reference.id}`;
		highlightedMessage = key;

		setTimeout(() => {
			if (highlightedMessage === key) highlightedMessage = undefined;
		}, 1300);
	}

	async function sendMessage() {
		if (!channel || sendDisabled) return;

		sendError = undefined;
		const text = messageContent;

		try {
			if (editingMessage) {
				await channel.send(text, { editOf: editingMessage });
				editingMessage = undefined;
				messageContent = draftBeforeEdit;
				draftBeforeEdit = "";
			} else {
				const target = replyTarget;
				await channel.send(text, { replyTo: target });
				replyTarget = undefined;
				messageContent = "";
			}
		} catch (error) {
			sendError = error instanceof Error ? error.message : String(error);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

		event.preventDefault();
		void sendMessage();
	}

	async function loadOlder() {
		if (!channel || loadOlderBusy) return;

		loadOlderBusy = true;
		try {
			await channel.loadHistory();
		} catch (error) {
			sendError = error instanceof Error ? error.message : String(error);
		} finally {
			loadOlderBusy = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-app">
	<header
		class="flex h-12 shrink-0 items-center gap-2.5 border-b border-black/20 px-4 shadow-[0_1px_0_rgba(0,0,0,0.2)]"
	>
		<GunAvatar
			pub={gid}
			avatarSource={channel?.meta?.avatar}
			class="h-6 w-6 shrink-0 rounded-full"
		/>
		<div class="min-w-0">
			<p class="truncate text-[15px] font-semibold text-ink">{title}</p>
			<p class="flex items-center gap-1 text-[10px] text-ink-muted">
				<Users class="h-3 w-3" />
				{memberCount} members
			</p>
		</div>
		<div class="ml-auto flex items-center gap-1">
			{#if canCall}
				<button
					type="button"
					title="Start voice call"
					aria-label="Start voice call"
					disabled={callBusy}
					class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => void groupCallManager.startCall(gid, "audio")}
				>
					<Phone class="h-4 w-4" />
				</button>
				<button
					type="button"
					title="Start video call"
					aria-label="Start video call"
					disabled={callBusy}
					class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => void groupCallManager.startCall(gid, "video")}
				>
					<Video class="h-4 w-4" />
				</button>
			{/if}
			<a
				href={`/groups/${gid}/settings`}
				title="Group settings"
				aria-label="Group settings"
				class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
			>
				<Settings class="h-4 w-4" />
			</a>
			<span class="ml-1 hidden items-center gap-1 text-[11px] font-medium text-ink-muted sm:flex">
				<Lock class="h-3 w-3" />
				Encrypted
			</span>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto py-4" bind:this={container}>
		{#if loadError}
			<div
				class="mx-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				{loadError}
			</div>
		{:else if loading}
			<div class="flex h-full items-center justify-center text-sm text-ink-muted">
				<LoaderCircle class="mr-2 h-4 w-4 animate-spin text-blurple" />
				Loading messages…
			</div>
		{:else if channel?.removed}
			<div class="mx-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
				You are no longer a member of this group. You can still read the messages that are
				already cached on this device.
			</div>
		{:else if channel && channel.messages.length === 0}
			<div class="flex h-full flex-col items-center justify-center px-6 text-center">
				<GunAvatar pub={gid} avatarSource={channel.meta?.avatar} class="mb-4 h-16 w-16 rounded-full" />
				<p class="text-xl font-semibold text-ink">{title}</p>
				{#if channel.meta?.description}
					<p class="mt-2 max-w-sm text-sm text-ink-soft">{channel.meta.description}</p>
				{/if}
				<p class="mt-1 max-w-sm text-sm text-ink-muted">
					This is the beginning of the group. Say hello to {memberCount} members.
				</p>
			</div>
		{:else if channel}
			<div class="flex justify-center pb-3">
				<Button size="sm" variant="ghost" disabled={loadOlderBusy} onclick={loadOlder}>
					{loadOlderBusy ? "Loading…" : "Load older messages"}
				</Button>
			</div>

			{#each channel.messages as message, i (messageKey(message))}
				<div id={messageElementId({ from: message.author.pub, id: message.timestamp })}>
					<Message
						alias={displayNameOf(message.author)}
						avatar={canSeeAvatar(message.author.pub) ? message.author.avatar : undefined}
						content={message.content}
						timestamp={message.timestamp}
						pub={message.author.pub}
						replyTo={message.replyTo}
						editedAt={message.editedAt}
						canEdit={canEdit(message)}
						highlighted={highlightedMessage === messageKey(message)}
						onReply={() => startReply(message)}
						onEdit={() => startEdit(message)}
						onOpenActions={() => openActions(message)}
						onJumpToReply={() => {
							if (message.replyTo) jumpToReply(message.replyTo);
						}}
						compact={!message.replyTo &&
							i > 0 &&
							channel.messages[i - 1].author.pub === message.author.pub &&
							message.timestamp - channel.messages[i - 1].timestamp < 5 * 60 * 1000}
					/>
				</div>
			{/each}
		{/if}
	</div>

	<div
		class="shrink-0 px-4 pt-1"
		style:padding-bottom="max(1rem, env(safe-area-inset-bottom))"
	>
		{#if sendError}
			<p
				class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
			>
				{sendError}
			</p>
		{/if}

		{#if replyTarget}
			<div class="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-blurple bg-elevated px-3 py-2">
				<Reply class="mt-0.5 h-4 w-4 shrink-0 text-blurple" />
				<div class="min-w-0 flex-1">
					<p class="truncate text-[11px] font-semibold text-blurple">
						Replying to {displayNameOf(replyTarget.author)}
					</p>
					<p class="mt-0.5 truncate text-xs text-ink-muted">{replyTarget.content}</p>
				</div>
				<button
					type="button"
					title="Cancel reply"
					aria-label="Cancel reply"
					class="rounded p-1 text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
					onclick={cancelReply}
				>
					<X class="h-4 w-4" />
				</button>
			</div>
		{/if}

		{#if editingMessage}
			<div class="mb-2 flex items-center gap-2 rounded-lg border border-white/5 bg-elevated px-3 py-2">
				<Pencil class="h-4 w-4 shrink-0 text-blurple" />
				<p class="min-w-0 flex-1 truncate text-xs font-medium text-ink">Editing message</p>
				<button
					type="button"
					title="Cancel edit"
					aria-label="Cancel edit"
					class="rounded p-1 text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
					onclick={cancelEdit}
				>
					<X class="h-4 w-4" />
				</button>
			</div>
		{/if}

		<div class="flex items-center gap-3 rounded-lg bg-elevated px-4 py-2.5">
			<Input
				bind:ref={composerInput}
				class="h-7 min-h-0 flex-1 border-0 bg-transparent px-0 py-0 text-[15px] text-ink shadow-none placeholder:text-ink-muted focus-visible:ring-0 dark:bg-transparent"
				type="text"
				bind:value={messageContent}
				onkeydown={handleKeydown}
				placeholder={editingMessage
					? "Edit message"
					: replyTarget
						? `Reply to ${displayNameOf(replyTarget.author)}`
						: `Message ${title}`}
				aria-label="Message"
				enterkeyhint="send"
			/>
			<button
				type="button"
				title={editingMessage ? "Save changes" : "Send message"}
				aria-label={editingMessage ? "Save changes" : "Send message"}
				disabled={sendDisabled}
				class="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-white/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
				onclick={() => void sendMessage()}
			>
				{#if editingMessage}
					<Check class="h-5 w-5" />
				{:else}
					<SendHorizontal class="h-5 w-5" />
				{/if}
			</button>
		</div>
		<p class="mt-2 text-center text-[11px] text-ink-muted/70">
			<Lock class="mr-1 inline h-3 w-3" />
			Messages are end-to-end encrypted.
		</p>
	</div>

	<MessageActionSheet
		message={actionSheetMessage}
		onclose={closeActions}
		onreply={replyFromSheet}
		onedit={editFromSheet}
	/>
</div>
