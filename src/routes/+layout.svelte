<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Navbar from '$lib/Components/Navbar/Navbar.svelte';
	import CallOverlay from '$lib/Components/CallOverlay/CallOverlay.svelte';
	import { onMount } from 'svelte';
	import { createGun } from '$lib/gun/Gun.svelte';

	let { children } = $props();

	onMount(() => {
		createGun();
	})
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AmberChat</title>
	<meta
		name="description"
		content="Amber is a decentralized chat app powered by GunDB"
	/>
</svelte:head>

<div class="flex h-dvh w-full flex-col overflow-hidden bg-app">
	<Navbar />
	<main class="min-h-0 flex-1">
		{@render children()}
	</main>
	<CallOverlay />
</div>
