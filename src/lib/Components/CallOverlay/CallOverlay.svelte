<script lang="ts">
	import { onDestroy } from "svelte";
	import Phone from "lucide-svelte/icons/phone";
	import PhoneOff from "lucide-svelte/icons/phone-off";
	import Mic from "lucide-svelte/icons/mic";
	import MicOff from "lucide-svelte/icons/mic-off";
	import Video from "lucide-svelte/icons/video";
	import VideoOff from "lucide-svelte/icons/video-off";
	import MonitorUp from "lucide-svelte/icons/monitor-up";
	import MonitorOff from "lucide-svelte/icons/monitor-off";
	import X from "lucide-svelte/icons/x";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";
	import { Button } from "../ui/button";
	import { gunData } from "$lib/gun/Gun.svelte";
	import { canSeeAvatar } from "$lib/gun/Friends.svelte";
	import { displayNameOf } from "$lib/profile";
	import { callManager } from "$lib/calls/CallManager.svelte";

	let remoteVideo = $state<HTMLVideoElement>();
	let remoteAudio = $state<HTMLAudioElement>();
	let localVideo = $state<HTMLVideoElement>();
	let elapsed = $state(0);

	const showCall = $derived(callManager.status !== "idle");
	const isVideoActive = $derived(callManager.status === "active" && callManager.hasRemoteVideo);
	const videoOn = $derived(callManager.hasLocalVideo && !callManager.cameraOff);

	$effect(() => {
		if (gunData.user) {
			callManager.init();
		} else {
			callManager.destroy();
		}
	});

	$effect(() => {
		const remote = callManager.remoteStream ?? null;
		const local = callManager.localPreviewStream ?? null;

		if (remoteVideo) remoteVideo.srcObject = remote;
		if (remoteAudio) remoteAudio.srcObject = remote;
		if (localVideo) localVideo.srcObject = local;
	});

	$effect(() => {
		const startedAt = callManager.startedAt;

		if (callManager.status !== "active" || !startedAt) {
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

	onDestroy(() => callManager.destroy());

	function formatDuration(total: number) {
		const minutes = Math.floor(total / 60);
		const seconds = total % 60;
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	}
</script>

{#snippet callControls()}
	<div class="flex items-center justify-center gap-3">
		<button
			type="button"
			title={callManager.muted ? "Unmute" : "Mute"}
			aria-label={callManager.muted ? "Unmute" : "Mute"}
			class="flex h-12 w-12 items-center justify-center rounded-full transition-colors {callManager.muted
				? 'bg-white text-rail hover:bg-white/90'
				: 'bg-white/10 text-ink hover:bg-white/20'}"
			onclick={() => callManager.toggleMute()}
		>
			{#if callManager.muted}
				<MicOff class="h-5 w-5" />
			{:else}
				<Mic class="h-5 w-5" />
			{/if}
		</button>

		<button
			type="button"
			title={videoOn ? "Turn camera off" : "Turn camera on"}
			aria-label={videoOn ? "Turn camera off" : "Turn camera on"}
			class="flex h-12 w-12 items-center justify-center rounded-full transition-colors {videoOn
				? 'bg-white text-rail hover:bg-white/90'
				: 'bg-white/10 text-ink hover:bg-white/20'}"
			onclick={() => void callManager.toggleVideo()}
		>
			{#if videoOn}
				<Video class="h-5 w-5" />
			{:else}
				<VideoOff class="h-5 w-5" />
			{/if}
		</button>

		<button
			type="button"
			title={callManager.screenSharing ? "Stop sharing" : "Share screen"}
			aria-label={callManager.screenSharing ? "Stop sharing" : "Share screen"}
			class="flex h-12 w-12 items-center justify-center rounded-full transition-colors {callManager.screenSharing
				? 'bg-white text-rail hover:bg-white/90'
				: 'bg-white/10 text-ink hover:bg-white/20'}"
			onclick={() =>
				void (callManager.screenSharing
					? callManager.stopScreenShare()
					: callManager.startScreenShare())}
		>
			{#if callManager.screenSharing}
				<MonitorOff class="h-5 w-5" />
			{:else}
				<MonitorUp class="h-5 w-5" />
			{/if}
		</button>

		<button
			type="button"
			title="End call"
			aria-label="End call"
			class="flex h-12 w-12 items-center justify-center rounded-full bg-destructive text-white transition-colors hover:bg-destructive/90"
			onclick={() => void callManager.endCall()}
		>
			<PhoneOff class="h-5 w-5" />
		</button>
	</div>
{/snippet}

{#if showCall && callManager.peer}
	{#if callManager.status === "incoming"}
		<div
			class="fixed bottom-6 right-6 z-[100] w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl"
		>
			<div class="flex items-center gap-3 p-4">
				<GunAvatar
					pub={callManager.peer.pub}
					avatarSource={canSeeAvatar(callManager.peer.pub) ? callManager.peer.avatar : undefined}
					class="h-11 w-11 shrink-0 rounded-full"
				/>
				<div class="min-w-0">
					<p class="truncate text-sm font-semibold text-ink">{displayNameOf(callManager.peer)}</p>
					<p class="text-xs text-ink-muted">Incoming {callManager.kind} call</p>
				</div>
			</div>
			<div class="flex gap-2 p-3 pt-0">
				<Button class="flex-1" variant="secondary" onclick={() => void callManager.reject()}>
					<PhoneOff class="h-4 w-4" />
					Decline
				</Button>
				<Button class="flex-1" onclick={() => void callManager.accept()}>
					<Phone class="h-4 w-4" />
					Accept
				</Button>
			</div>
		</div>
	{:else if callManager.status === "outgoing" || callManager.status === "connecting"}
		<div
			class="fixed bottom-6 right-6 z-[100] w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl"
		>
			<div class="flex items-center gap-3 p-4">
				<GunAvatar
					pub={callManager.peer.pub}
					avatarSource={canSeeAvatar(callManager.peer.pub) ? callManager.peer.avatar : undefined}
					class="h-11 w-11 shrink-0 rounded-full"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-semibold text-ink">{displayNameOf(callManager.peer)}</p>
					<p class="text-xs text-ink-muted">
						{callManager.status === "outgoing" ? "Calling…" : "Connecting…"}
					</p>
				</div>
				<LoaderCircle class="h-5 w-5 animate-spin text-blurple" />
			</div>
			<div class="p-3 pt-0">
				<Button class="w-full" variant="secondary" onclick={() => void callManager.endCall()}>
					<PhoneOff class="h-4 w-4" />
					Cancel
				</Button>
			</div>
		</div>
	{:else if callManager.status === "active"}
		{#if isVideoActive}
			<div class="fixed inset-0 z-[100] bg-black">
				<video
					bind:this={remoteVideo}
					autoplay
					playsinline
					class="h-full w-full object-cover"
				></video>

				<div
					class="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 text-white backdrop-blur"
				>
					<GunAvatar
						pub={callManager.peer.pub}
						avatarSource={canSeeAvatar(callManager.peer.pub) ? callManager.peer.avatar : undefined}
						class="h-7 w-7 rounded-full"
					/>
					<div>
						<p class="text-sm font-semibold">{displayNameOf(callManager.peer)}</p>
						<p class="text-[11px] text-white/70">{formatDuration(elapsed)}</p>
					</div>
				</div>

				<video
					bind:this={localVideo}
					autoplay
					playsinline
					muted
					class="absolute bottom-24 right-4 h-40 w-28 rounded-lg border border-white/15 object-cover shadow-xl sm:h-48 sm:w-36"
				></video>

				<div
					class="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 p-2 backdrop-blur"
				>
					{@render callControls()}
				</div>
			</div>
		{:else}
			<div class="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-rail px-6 text-center">
				<audio bind:this={remoteAudio} autoplay class="hidden"></audio>
				{#if callManager.hasLocalVideo && !callManager.cameraOff}
					<video
						bind:this={localVideo}
						autoplay
						playsinline
						muted
						class="absolute bottom-24 right-4 h-40 w-28 rounded-lg border border-white/15 object-cover shadow-xl sm:h-48 sm:w-36"
					></video>
				{/if}
				<GunAvatar
					pub={callManager.peer.pub}
					avatarSource={canSeeAvatar(callManager.peer.pub) ? callManager.peer.avatar : undefined}
					class="h-24 w-24 rounded-full"
				/>
				<p class="mt-4 text-2xl font-semibold text-ink">{displayNameOf(callManager.peer)}</p>
				<p class="mt-1 text-sm text-ink-muted">{formatDuration(elapsed)}</p>

				<div class="mt-8">
					{@render callControls()}
				</div>
			</div>
		{/if}
	{/if}
{/if}

{#if callManager.error}
	<div
		class="fixed right-4 top-4 z-[110] flex max-w-sm items-start gap-3 rounded-lg border border-destructive/30 bg-panel px-4 py-3 shadow-2xl"
	>
		<p class="flex-1 text-sm text-ink">{callManager.error}</p>
		<button
			type="button"
			title="Dismiss"
			aria-label="Dismiss"
			class="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-ink"
			onclick={() => callManager.clearError()}
		>
			<X class="h-4 w-4" />
		</button>
	</div>
{/if}
