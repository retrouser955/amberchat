<script lang="ts">
	let {
		stream,
		muted = false,
		class: className = ""
	}: {
		stream?: MediaStream;
		muted?: boolean;
		class?: string;
	} = $props();

	let video = $state<HTMLVideoElement>();

	$effect(() => {
		if (video) video.srcObject = stream ?? null;
	});
</script>

<video bind:this={video} autoplay playsinline {muted} class={className}></video>
