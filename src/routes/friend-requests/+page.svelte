<script lang="ts">
	import { Input } from "$lib/Components/ui/input";
	import { Button } from "$lib/Components/ui/button";
	import { acceptFriend, addFriend, createInvite } from "$lib/gun/User/User";
	import { onMount } from "svelte";
	import { createGun, getUser } from "$lib/gun/Gun.svelte";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";

	let inviteLink = $state<string>("");
	let frequestPub = $state<string[]>([]);
	let friendRequests = $state<{ pub: string, alias: string, avatar?: string }[]>([]);

	$effect(() => {
		if(frequestPub.length === 0) return;
		const gun = createGun();
		for(const pub of frequestPub) {
			;(async () => {
				friendRequests.push({
					alias: await gun.get(`~${pub}`).get("alias").then(),
					avatar: await gun.get(`~${pub}`).get("avatar").then(),
					pub
				})
			})()
		}
	})

	onMount(() => {
		const user = getUser();
		const off = user.get<Record<string, string>>("fr").map().once(async (v, k) => {
			if(frequestPub.includes(k) || v === null) return;
			frequestPub.push(k);
		}).off

		return () => {
			try {
				off()
			} catch {
				// noop
			}
		};
	})
</script>

<div class="h-enough w-screen flex justify-center px-10 pt-10">
	<div>
		<div class="flex">
			<Input class="h-16 w-96" bind:value={inviteLink} />
			<Button
				class="h-16 ml-3 text-lg"
				variant="secondary"
				onclick={() => {
					if(inviteLink === "") return;
					if(new URL(inviteLink).protocol !== "amber:") return;
					addFriend(inviteLink);
				}}
			>Request</Button>
			<Button
				class="h-16 ml-3 text-lg"
				variant="secondary"
				onclick={async () => {
					const inv = await createInvite();
					navigator.clipboard.writeText(inv);
				}}>Copy invite</Button
			>
		</div>

		<div class="w-full mt-3">
			{#each friendRequests as req}
				<div class="h-20 flex rounded-lg hover:bg-neutral-950 transition-colors items-center px-6 py-1">
					<GunAvatar pub={req.pub} avatarSource={req.avatar} class="rounded-full h-16" />
					<p class="text-lg ml-6">{req.alias}</p>
					<Button class="text-lg ml-auto" variant="secondary" onclick={() => {
						acceptFriend(req.pub);
						frequestPub.splice(frequestPub.findIndex((v) => v === req.pub), 1);
					}}>Accept</Button>
				</div>
			{/each}
		</div>
	</div>
</div>
