<script lang="ts">
	import favicon from "$lib/assets/favicon.svg";
	import Lock from "lucide-svelte/icons/lock";
	import Radio from "lucide-svelte/icons/radio";
	import ShieldCheck from "lucide-svelte/icons/shield-check";
</script>

<div class="relative flex h-full items-center justify-center overflow-hidden bg-app px-6 py-12">
	<div class="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-[90%] -translate-y-1/2 rounded-full bg-amber-500/15 blur-[120px]"></div>
	<div class="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-[10%] -translate-y-1/2 rounded-full bg-blurple/20 blur-[120px]"></div>

	<div class="relative z-10 max-w-2xl text-center">
		<img
			src={favicon}
			alt="AmberChat logo"
			class="mx-auto h-20 w-20 rounded-2xl shadow-2xl ring-1 ring-white/10"
		/>

		<h1 class="mt-8 text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
			Amber
		</h1>
		<p class="mx-auto mt-4 max-w-lg text-lg leading-7 text-ink-muted">
			Private, peer-to-peer messaging built for conversations that stay yours.
		</p>

		<div class="mt-8 flex flex-wrap items-center justify-center gap-2">
			<span class="flex items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-ink-soft">
				<Lock class="h-3.5 w-3.5 text-positive" />
				End-to-end encrypted
			</span>
			<span class="flex items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-ink-soft">
				<Radio class="h-3.5 w-3.5 text-blurple" />
				Peer-to-peer
			</span>
			<span class="flex items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-ink-soft">
				<ShieldCheck class="h-3.5 w-3.5 text-positive" />
				No phone number
			</span>
		</div>

		<p class="mt-10 text-sm text-ink-muted">
			Sign in from the top bar to start chatting.
		</p>
	</div>
</div>
