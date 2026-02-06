<script lang="ts">
	import type { HTMLImgAttributes } from "svelte/elements";
	import { gunAvatar } from "gun-avatar"

	let {
		avatarSource,
		pub,
		size,
		...rest
	}: Omit<HTMLImgAttributes, "src"> & {
		avatarSource?: string,
		size?: number,
		pub: string
	} = $props();
</script>

<img {...rest} src={
	avatarSource ||
	// @ts-expect-error
	gunAvatar({ pub, size: size || 200 })
}>