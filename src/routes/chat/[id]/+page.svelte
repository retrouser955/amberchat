<script lang='ts'>
	import { page } from "$app/state";
	import GunAvatar from "$lib/Components/GunAvatar/GunAvatar.svelte";
	import Message from "$lib/Components/Message/Message.svelte";
	import { Input } from "$lib/Components/ui/input";
	import { createGun } from "$lib/gun/Gun.svelte";
	import { onMount } from "svelte";

	const uid = page.params.id!;

	let userData = $state<{
		alias: string,
		avatar?: string
	}>()

	onMount(async () => {
		const gun = createGun();
		const data = await gun.get(`~${uid}`).then();
		userData = {
			alias: data.alias,
			avatar: data.avatar
		}
	})
</script>
<div class="w-full h-10 border-b border-neutral-700 flex items-center px-3">
	<GunAvatar pub={uid} avatarSource={userData?.avatar} class="h-7 rounded-full" />
	<p class="ml-3 text-neutral-400">{userData?.alias}</p>
</div>
<div class="h-[calc(100%-2.5rem)] w-full">
	<div class="h-[calc(100%-5rem)] w-full">
		<Message
			pub="cjkdashuicjoa398dcaedfcedacdas"
			avatar="https://cdn.discordapp.com/avatars/691111067807514685/f3eb31d2fbba26d0499d2147660d2aa5.webp?size=128"
			alias="retrouser955"
			content="Hello World! This is a longg string. Here goes. chduiasjhfcnkdsahuilcdhaiukshdusahuycd snbaghjjcg vfhdagwshfgbyujkzsghbcyud asyuefdgyuasg tcydfgavbshy gbvcydsa gftjmdawfgv tyhfg dvayhs fgvyhdsagv yhmfuucgsvayjhuf gdjyuasgt fyudsagfvytdsagv fyugbvdasyfg vyhujdsag fhgafgvytesagfdtyevfsay btfgytwageyu fgyesuaf gcvydhuasgt rfbyesagvfhyueawgybn efbhgujy"
			timestamp={Date.now() - 8.64e+7}
		/>
	</div>
	<div class="h-20 w-full p-2">
		<Input class="h-full w-full border-none" type="text" />
	</div>
</div>