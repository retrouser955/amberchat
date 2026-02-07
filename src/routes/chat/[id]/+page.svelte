<script lang="ts">
	import { page } from "$app/state";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import Message from "$lib/Components/Message/Message.svelte";
	import { Input } from "$lib/Components/ui/input";
	import { createGun } from "$lib/gun/Gun.svelte";
	import { DMChannel } from "$lib/gun";
	import { onMount } from "svelte";

	const uid = page.params.id!;

	let messageContent = $state<string>();
	let userData = $state<{
		alias: string;
		avatar?: string;
	}>();

	let dm = new DMChannel(uid);
	let container: HTMLDivElement;

	$effect(() => {
		if(dm.messages.length === 0) return;
		const lastChild = container.children[container.children.length - 1];
		
		lastChild.scrollIntoView({
			behavior: "smooth"
		})
	})

	onMount(() => {
		const gun = createGun();

		let off: Function | undefined = undefined;

		(async () => {
			const data = await gun.get(`~${uid}`).then();
			userData = {
				alias: data.alias,
				avatar: data.avatar,
			};

			await dm.fetchUserEpub();

			off = dm.listen();
		})();

		return () => {
			try {
				off?.();
			} catch {
				// no-op
			}
		};
	});
</script>

<div class="w-full h-10 border-b border-neutral-700 flex items-center px-3">
	<GunAvatar
		pub={uid}
		avatarSource={userData?.avatar}
		class="h-7 rounded-full"
	/>
	<p class="ml-3 text-neutral-400">{userData?.alias}</p>
</div>
<div class="h-[calc(100%-2.5rem)] w-full">
	<div class="h-[calc(100%-5rem)] w-full overflow-auto" bind:this={container}>
		{#each dm.messages as message}
			<Message
				alias={message.author.alias}
				avatar={message.author.avatar}
				content={message.content}
				timestamp={message.timestamp}
				pub={message.author.pub}
			/>
		{/each}
	</div>
	<div class="h-20 w-full p-2">
		<Input class="h-full w-full border-none" type="text" bind:value={messageContent} onkeydown={async (e) => {
			if(e.key === "Enter" && document.activeElement === e.target) {
				if(!messageContent || messageContent.trim() === "") return;

				try {
					await dm.send(messageContent)
					messageContent = "";
				} catch (error) {
					console.log(error);
				}
			}
		}} />
	</div>
</div>
