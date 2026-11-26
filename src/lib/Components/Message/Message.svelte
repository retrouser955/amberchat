<script lang="ts">
	import moment from "moment";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";
	import { onMount } from "svelte";

	const {
		pub,
		content,
		avatar,
		timestamp,
		alias,
		compact = false
	}: {
		pub: string,
		content: string,
		avatar?: string,
		timestamp: number,
		alias: string,
		compact?: boolean
	} = $props()

	let tsReactive = $state<string>("");

	onMount(() => {
		const messageTime = moment(timestamp);

		if (messageTime.isSame(moment(), "day")) {
			tsReactive = messageTime.format("[Today at] h:mm A");
		} else if (messageTime.isSame(moment().subtract(1, "day"), "day")) {
			tsReactive = messageTime.format("[Yesterday at] h:mm A");
		} else {
			tsReactive = messageTime.format("MMM D, YYYY [at] h:mm A");
		}
	})
</script>

<div class={compact ? "group px-4 py-0.5 hover:bg-black/[0.06]" : "group mt-4 px-4 py-0.5 hover:bg-black/[0.06]"}>
	{#if compact}
		<div class="flex items-start gap-3">
			<div class="w-10 shrink-0 pt-0.5 text-right">
				<time class="invisible text-[10px] leading-5 text-ink-muted group-hover:visible" datetime={new Date(timestamp).toISOString()}>
					{tsReactive}
				</time>
			</div>
			<p class="min-w-0 whitespace-pre-wrap break-words text-[15px] leading-[1.375rem] text-ink-soft">
				{content}
			</p>
		</div>
	{:else}
		<div class="flex items-start gap-3">
			<GunAvatar {pub} avatarSource={avatar} class="h-10 w-10 shrink-0 rounded-full" />
			<div class="min-w-0 flex-1">
				<div class="flex items-baseline gap-2">
					<span class="text-[15px] font-medium text-ink">{alias}</span>
					<time class="text-[11px] text-ink-muted" datetime={new Date(timestamp).toISOString()}>
						{tsReactive}
					</time>
				</div>
				<p class="whitespace-pre-wrap break-words text-[15px] leading-[1.375rem] text-ink-soft">
					{content}
				</p>
			</div>
		</div>
	{/if}
</div>
