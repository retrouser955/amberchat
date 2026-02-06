<script lang="ts">
	import moment from "moment";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";

	const {
		pub,
		content,
		avatar,
		timestamp,
		alias
	}: {
		pub: string,
		content: string,
		avatar?: string,
		timestamp: number,
		alias: string
	} = $props()
</script>
<div class="min-h-14 w-full p-2 flex">
	<div class="w-14">
		<GunAvatar {pub} avatarSource={avatar} class="rounded-full h-14" />
	</div>
	<div class="ml-3 w-[calc(100%-3.5rem)]">
		<p class="text-white">{alias} <span class="text-neutral-500 ml-1">{moment(new Date(timestamp)).fromNow()}</span></p>
		<p class="text-neutral-400">{content}</p>
	</div>
</div>