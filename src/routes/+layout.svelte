<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
  	import Navbar from '$lib/Components/Navbar/Navbar.svelte';
	import { onMount } from 'svelte';
	import { createGun } from '$lib/gun/Gun.svelte';

	let { children } = $props();

	onMount(() => {
		createGun();
	})
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="w-screen min-h-screen bg-black">
	<Navbar />
	<div class="w-screen min-h-[calc(100vh-5rem)]">
		{@render children()}
	</div>
</div>