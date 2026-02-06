<script lang="ts">
	import { onMount } from "svelte";
	import Contact from "./Contact.svelte";
	import { createGun, getUser } from "$lib/gun/Gun.svelte";

	let friends = $state<{alias: string,avatar?: string, pub: string}[]>([]);

	onMount(() => {
		const user = getUser();
		const gun = createGun();
		
		user.get<Record<string, string>>("friends").map().once(async (_, k) => {
			await navigator.locks.request("CHAT_FRIENDS_SIDEBAR", async () => {
				if(friends.find((v) => v.pub === k)) return;

				friends.push({
					alias: await gun.get(`~${k}`).get("alias").then(),
					avatar: await gun.get(`~${k}`).get("avatar").then(),
					pub: k
				})
			})
		})
	})
</script>
<div class="w-1/5 border-neutral-700 bg-neutral-950 border-r px-2 py-1 h-enough overflow-x-hidden">
	<p class="text-neutral-500 hover:text-neutral-600 mb-2 cursor-default transition-colors">Direct Messages</p>
	{#each friends as friend}
		<Contact alias={friend.alias} avatar={friend.avatar} pub={friend.pub} />
	{/each}
</div>