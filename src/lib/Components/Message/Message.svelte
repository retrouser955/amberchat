<script lang="ts">
	import moment from "moment";
	import Reply from "lucide-svelte/icons/reply";
	import Pencil from "lucide-svelte/icons/pencil";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";
	import { onDestroy, onMount } from "svelte";
	import type { ReplyReference } from "$lib/gun";

	const {
		pub,
		content,
		avatar,
		timestamp,
		alias,
		compact = false,
		replyTo,
		editedAt,
		canEdit = false,
		highlighted = false,
		onReply,
		onEdit,
		onOpenActions,
		onJumpToReply
	}: {
		pub: string;
		content: string;
		avatar?: string;
		timestamp: number;
		alias: string;
		compact?: boolean;
		replyTo?: ReplyReference;
		editedAt?: number;
		canEdit?: boolean;
		highlighted?: boolean;
		onReply?: () => void;
		onEdit?: () => void;
		onOpenActions?: () => void;
		onJumpToReply?: () => void;
	} = $props();

	let fullTimestamp = $state<string>("");
	let inlineTimestamp = $state<string>("");
	let swipeOffset = $state(0);
	let gestureActive = false;
	let swiping = false;
	let didAction = false;
	let startX = 0;
	let startY = 0;
	let longPressTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		const messageTime = moment(timestamp);

		inlineTimestamp = messageTime.format("h:mmA");

		if (messageTime.isSame(moment(), "day")) {
			fullTimestamp = messageTime.format("[Today at] h:mmA");
		} else if (messageTime.isSame(moment().subtract(1, "day"), "day")) {
			fullTimestamp = messageTime.format("[Yesterday at] h:mmA");
		} else {
			fullTimestamp = messageTime.format("MMM D, YYYY [at] h:mmA");
		}
	});

	onDestroy(clearLongPress);

	function clearLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = undefined;
		}
	}

	function cancelGesture() {
		clearLongPress();
		gestureActive = false;
		swiping = false;
		swipeOffset = 0;
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.pointerType !== "touch" || event.button !== 0) return;

		const target = event.target as HTMLElement;
		if (target.closest("button,a")) return;

		clearLongPress();
		gestureActive = true;
		swiping = false;
		didAction = false;
		swipeOffset = 0;
		startX = event.clientX;
		startY = event.clientY;

		longPressTimer = setTimeout(() => {
			if (!gestureActive || swiping) return;

			didAction = true;
			navigator.vibrate?.(10);
			onOpenActions?.();
		}, 450);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!gestureActive) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearLongPress();

		if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
			cancelGesture();
			return;
		}

		if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
			swiping = true;
			swipeOffset = Math.min(dx, 72);
		}
	}

	function handlePointerUp() {
		if (gestureActive && swipeOffset >= 52 && !didAction) {
			onReply?.();
		}

		cancelGesture();
	}

	function handleContextMenu(event: MouseEvent) {
		if (window.matchMedia("(pointer: coarse)").matches) {
			event.preventDefault();
		}
	}
</script>

<div
	role="group"
	aria-label={`Message from ${alias}`}
	class={compact ? "group relative overflow-hidden" : "group relative mt-4 overflow-hidden"}
	style:touch-action="pan-y"
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={cancelGesture}
	onpointerleave={cancelGesture}
	oncontextmenu={handleContextMenu}
>
	{#if swipeOffset > 0}
		<div
			class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-blurple"
			style:opacity={Math.min(swipeOffset / 52, 1)}
		>
			<Reply class="h-5 w-5" />
		</div>
	{/if}

	<div
		class={`relative px-4 py-0.5 ${highlighted ? "bg-blurple/10" : "bg-app group-hover:bg-black/[0.06]"}`}
		style:transform={`translateX(${swipeOffset}px)`}
		style:transition={swipeOffset === 0 ? "transform 140ms ease" : "none"}
	>
		{#if onReply || canEdit}
			<div
				class="absolute right-3 top-1 z-10 hidden items-center gap-0.5 rounded-md border border-white/10 bg-panel p-0.5 shadow-lg group-hover:flex"
			>
				<button
					type="button"
					title="Reply"
					aria-label="Reply"
					class="rounded p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
					onclick={() => onReply?.()}
				>
					<Reply class="h-4 w-4" />
				</button>
				{#if canEdit}
					<button
						type="button"
						title="Edit message"
						aria-label="Edit message"
						class="rounded p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
						onclick={() => onEdit?.()}
					>
						<Pencil class="h-4 w-4" />
					</button>
				{/if}
			</div>
		{/if}

		{#if compact}
			<div class="flex items-start gap-3">
				<div class="flex h-[1.375rem] w-10 shrink-0 items-center justify-end">
					<time
						class="invisible text-[10px] leading-none text-ink-muted group-hover:visible"
						datetime={new Date(timestamp).toISOString()}
					>
						{inlineTimestamp}
					</time>
				</div>
				<div class="min-w-0 flex-1">
					{#if replyTo}
						<button
							type="button"
							class="mb-1 flex w-full items-start gap-2 rounded border-l-2 border-blurple bg-white/[0.03] px-2 py-1 text-left transition-colors hover:bg-white/[0.06]"
							onclick={() => onJumpToReply?.()}
						>
							<Reply class="mt-0.5 h-3.5 w-3.5 shrink-0 text-blurple" />
							<span class="min-w-0">
								<span class="block truncate text-[11px] font-semibold text-blurple">
									{replyTo.alias ?? "Message"}
								</span>
								<span class="line-clamp-2 block text-[11px] leading-4 text-ink-muted">
									{replyTo.preview}
								</span>
							</span>
						</button>
					{/if}
					<p class="min-w-0 whitespace-pre-wrap break-words text-[15px] leading-[1.375rem] text-ink-soft">
						{content}{#if editedAt}<span class="ml-1 text-[10px] text-ink-muted">(edited)</span>{/if}
					</p>
				</div>
			</div>
		{:else}
			<div class="flex items-start gap-3">
				<GunAvatar {pub} avatarSource={avatar} class="h-10 w-10 shrink-0 rounded-full" />
				<div class="min-w-0 flex-1">
					<div class="flex items-baseline gap-2">
						<span class="text-[15px] font-medium text-ink">{alias}</span>
						<time class="text-[11px] text-ink-muted" datetime={new Date(timestamp).toISOString()}>
							{fullTimestamp}
						</time>
						{#if editedAt}
							<span class="text-[11px] text-ink-muted">(edited)</span>
						{/if}
					</div>
					{#if replyTo}
						<button
							type="button"
							class="mb-1 mt-1 flex w-full items-start gap-2 rounded border-l-2 border-blurple bg-white/[0.03] px-2 py-1 text-left transition-colors hover:bg-white/[0.06]"
							onclick={() => onJumpToReply?.()}
						>
							<Reply class="mt-0.5 h-3.5 w-3.5 shrink-0 text-blurple" />
							<span class="min-w-0">
								<span class="block truncate text-[11px] font-semibold text-blurple">
									{replyTo.alias ?? "Message"}
								</span>
								<span class="line-clamp-2 block text-[11px] leading-4 text-ink-muted">
									{replyTo.preview}
								</span>
							</span>
						</button>
					{/if}
					<p class="whitespace-pre-wrap break-words text-[15px] leading-[1.375rem] text-ink-soft">
						{content}
					</p>
				</div>
			</div>
		{/if}
	</div>
</div>
