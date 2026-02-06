<script>
	import Sidebar from "$lib/Components/Sidebar/Sidebar.svelte";

	let { children } = $props();
</script>
<div class="flex">
	<Sidebar />
	<div class="w-4/5 h-enough">
		{@render children()}
	</div>
</div>