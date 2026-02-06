<script lang="ts">
	import { gunAvatar } from "gun-avatar";

	const {
		avatar,
		pub,
		alias
	}: {
		avatar?: string,
		pub: string,
		alias: string,
	} = $props()
</script>

<a class="w-full h-14 flex cursor-pointer p-1 rounded-lg justify-start items-center hover:bg-neutral-900 transition-colors" href={`/chat/${pub}`}>
	<img
		src={
			avatar
			// @ts-expect-error
			|| gunAvatar({ pub, size: 200 })
		}
		alt={`${alias}'s' avatar`}
		class="h-12 rounded-full"
	>
	<p class="ml-2 text-lg text-neutral-200">{alias}</p>
</a>