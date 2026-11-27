<script lang="ts">
	import { onDestroy } from "svelte";
	import Mic from "lucide-svelte/icons/mic";
	import MicOff from "lucide-svelte/icons/mic-off";
	import MonitorOff from "lucide-svelte/icons/monitor-off";
	import MonitorUp from "lucide-svelte/icons/monitor-up";
	import Phone from "lucide-svelte/icons/phone";
	import PhoneOff from "lucide-svelte/icons/phone-off";
	import Video from "lucide-svelte/icons/video";
	import VideoOff from "lucide-svelte/icons/video-off";
	import X from "lucide-svelte/icons/x";
	import Users from "lucide-svelte/icons/users";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";
	import GroupAvatar from "../GroupAvatar/GroupAvatar.svelte";
	import { Button } from "../ui/button";
	import { gunData } from "$lib/gun/Gun.svelte";
	import { canSeeAvatar } from "$lib/gun/Friends.svelte";
	import { displayNameOf } from "$lib/profile";
	import { groupCallManager } from "$lib/calls/GroupCallManager.svelte";
	import { callManager } from "$lib/calls/CallManager.svelte";
	import GroupVideo from "./GroupVideo.svelte";

	let elapsed = $state(0);

	const selfParticipant = $derived(
		gunData.user ? groupCallManager.participants[gunData.user.pub] : undefined
	);
	const remotes = $derived(
		Object.values(groupCallManager.participants).filter(
			(participant) => participant.pub !== gunData.user?.pub
		)
	);
	const showCall = $derived(groupCallManager.status !== "idle");
	const showIncoming = $derived(
		!!groupCallManager.incoming &&
			groupCallManager.status === "idle" &&
			callManager.status === "idle"
	);
	const callActive = $derived(
		groupCallManager.status === "active" || groupCallManager.status === "connecting"
	);

	$effect(() => {
		if (gunData.user) {
			groupCallManager.init();
		} else {
			groupCallManager.destroy();
		}
	});

	$effect(() => {
		const startedAt = groupCallManager.startedAt;

		if (!callActive || !startedAt) {
			elapsed = 0;
			return;
		}

		const update = () => {
			elapsed = Math.floor((Date.now() - startedAt) / 1000);
		};

		update();
		const interval = setInterval(update, 1000);

		return () => clearInterval(interval);
	});

	onDestroy(() => groupCallManager.destroy());

	function formatDuration(total: number) {
		const minutes = Math.floor(total / 60);
		const seconds = total % 60;
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	}
</script>

{#if showIncoming && groupCallManager.incoming}
	<div
		class="fixed bottom-6 right-6 z-[100] w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl"
	>
		<div class="flex items-center gap-3 p-4">
			<GunAvatar
				pub={groupCallManager.incoming.startedBy}
				avatarSource={canSeeAvatar(groupCallManager.incoming.startedBy)
					? groupCallManager.incoming.startedByAvatar
					: undefined}
				class="h-11 w-11 shrink-0 rounded-full"
			/>
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold text-ink">
					{groupCallManager.incoming.name}
				</p>
				<p class="truncate text-xs text-ink-muted">
					{groupCallManager.incoming.startedByName} started a
					{groupCallManager.incoming.kind} call
				</p>
			</div>
		</div>
		<div class="flex gap-2 p-3 pt-0">
			<Button class="flex-1" variant="secondary" onclick={() => groupCallManager.decline()}>
				<PhoneOff class="h-4 w-4" />
				Decline
			</Button>
			<Button class="flex-1" onclick={() => void groupCallManager.accept()}>
				<Phone class="h-4 w-4" />
				Join
			</Button>
		</div>
	</div>
{/if}

{#if showCall}
	<div class="fixed inset-0 z-[100] flex flex-col bg-rail text-ink">
		<header class="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 px-4">
			<GroupAvatar
				gid={groupCallManager.gid ?? ""}
				class="h-8 w-8"
				iconClass="h-4 w-4"
			/>
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold">
					{groupCallManager.groupName || "Group call"}
				</p>
				<p class="text-[11px] text-ink-muted">
					{#if groupCallManager.status === "connecting"}
						Connecting…
					{:else}
						{remotes.length + 1} in call · {formatDuration(elapsed)}
					{/if}
				</p>
			</div>
			<span class="ml-auto rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-ink-muted">
				{groupCallManager.kind}
			</span>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#if remotes.length === 0}
				<div class="flex h-full flex-col items-center justify-center gap-3 text-center">
					{#if groupCallManager.status === "connecting"}
						<LoaderCircle class="h-8 w-8 animate-spin text-blurple" />
						<p class="text-sm text-ink-muted">Waiting for the others to join…</p>
					{:else}
						<Users class="h-10 w-10 text-ink-muted" />
						<p class="text-sm text-ink-muted">You are the only one here so far.</p>
					{/if}
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each remotes as participant (participant.pub)}
						<div
							class="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40"
						>
							<GroupVideo
								stream={participant.stream}
								class={participant.hasVideo
									? "h-full w-full object-cover"
									: "absolute h-0 w-0 opacity-0"}
							/>
							{#if !participant.hasVideo}
								<div class="flex flex-col items-center gap-2">
									<GunAvatar
										pub={participant.pub}
										avatarSource={canSeeAvatar(participant.pub)
											? participant.avatar
											: undefined}
										class="h-16 w-16 rounded-full"
									/>
									<p class="text-sm font-medium text-ink">
										{displayNameOf(participant)}
									</p>
								</div>
							{/if}
							<div
								class="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur"
							>
								{displayNameOf(participant)}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if selfParticipant?.hasVideo}
			<div
				class="absolute bottom-24 right-4 h-32 w-48 overflow-hidden rounded-lg border border-white/15 bg-black shadow-xl sm:h-40 sm:w-60"
			>
				<GroupVideo
					stream={selfParticipant.stream}
					muted
					class="h-full w-full object-cover"
				/>
				<span class="absolute bottom-1.5 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
					You
				</span>
			</div>
		{/if}

		<footer class="shrink-0 px-4 pb-6 pt-3">
			<div class="flex items-center justify-center gap-3">
				<button
					type="button"
					title={groupCallManager.muted ? "Unmute" : "Mute"}
					aria-label={groupCallManager.muted ? "Unmute" : "Mute"}
					class="flex h-12 w-12 items-center justify-center rounded-full transition-colors {groupCallManager.muted
						? 'bg-white text-rail hover:bg-white/90'
						: 'bg-white/10 text-ink hover:bg-white/20'}"
					onclick={() => groupCallManager.toggleMute()}
				>
					{#if groupCallManager.muted}
						<MicOff class="h-5 w-5" />
					{:else}
						<Mic class="h-5 w-5" />
					{/if}
				</button>

				<button
					type="button"
					title={groupCallManager.cameraOn ? "Turn camera off" : "Turn camera on"}
					aria-label={groupCallManager.cameraOn ? "Turn camera off" : "Turn camera on"}
					class="flex h-12 w-12 items-center justify-center rounded-full transition-colors {groupCallManager.cameraOn
						? 'bg-white text-rail hover:bg-white/90'
						: 'bg-white/10 text-ink hover:bg-white/20'}"
					onclick={() => void groupCallManager.toggleVideo()}
				>
					{#if groupCallManager.cameraOn}
						<Video class="h-5 w-5" />
					{:else}
						<VideoOff class="h-5 w-5" />
					{/if}
				</button>

				<button
					type="button"
					title={groupCallManager.screenSharing ? "Stop sharing" : "Share screen"}
					aria-label={groupCallManager.screenSharing ? "Stop sharing" : "Share screen"}
					class="flex h-12 w-12 items-center justify-center rounded-full transition-colors {groupCallManager.screenSharing
						? 'bg-white text-rail hover:bg-white/90'
						: 'bg-white/10 text-ink hover:bg-white/20'}"
					onclick={() =>
						void (groupCallManager.screenSharing
							? groupCallManager.stopScreenShare()
							: groupCallManager.startScreenShare())}
				>
					{#if groupCallManager.screenSharing}
						<MonitorOff class="h-5 w-5" />
					{:else}
						<MonitorUp class="h-5 w-5" />
					{/if}
				</button>

				<button
					type="button"
					title="Leave call"
					aria-label="Leave call"
					class="flex h-12 w-12 items-center justify-center rounded-full bg-destructive text-white transition-colors hover:bg-destructive/90"
					onclick={() => void groupCallManager.leaveCall()}
				>
					<PhoneOff class="h-5 w-5" />
				</button>
			</div>
		</footer>
	</div>
{/if}

{#if groupCallManager.error}
	<div
		class="fixed right-4 top-4 z-[110] flex max-w-sm items-start gap-3 rounded-lg border border-destructive/30 bg-panel px-4 py-3 shadow-2xl"
	>
		<p class="flex-1 text-sm text-ink">{groupCallManager.error}</p>
		<button
			type="button"
			title="Dismiss"
			aria-label="Dismiss"
			class="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-ink"
			onclick={() => (groupCallManager.error = undefined)}
		>
			<X class="h-4 w-4" />
		</button>
	</div>
{/if}
