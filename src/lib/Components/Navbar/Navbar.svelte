<script lang="ts">
	import Rocket from "lucide-svelte/icons/rocket";
	import * as Dialog from "../ui/dialog";
	import { Button, buttonVariants } from "../ui/button";
	import { Label } from "../ui/label";
	import { Input } from "../ui/input";
	import { getUser, gunData } from "$lib/gun/Gun.svelte";
	import { goto } from "$app/navigation";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";

	let username = $state<string>("");
	let password = $state<string>("");
</script>

<nav
	class="h-20 bg-black flex w-screen px-6 items-center border-b border-neutral-700"
>
	<img
		src="https://amber-dchat.github.io/favicon.png"
		alt="Amberchat logo"
		class="h-16 rounded-lg"
	/>
	<p class="ml-3 text-2xl font-bold text-white mr-auto">Amber</p>
	{#if !gunData.user}
		<Dialog.Root>
			<form>
				<Dialog.Trigger class={buttonVariants({ variant: "outline" })}>
					<Rocket />
					<p class="ml-1">Get Started</p>
				</Dialog.Trigger>
				<Dialog.Content>
					<Dialog.Header>
						<Dialog.Title>Authenticate</Dialog.Title>
						<Dialog.Description>
							Create an account or login to start chatting.
						</Dialog.Description>
					</Dialog.Header>
					<div class="grid gap-4">
						<div class="grid gap-3">
							<Label
								for="username"
								class={username === "" ? "text-red-500" : ""}>Username</Label
							>
							<Input
								id="username"
								class={username === "" ? "border-red-500" : ""}
								bind:value={username}
								name="Username"
							/>
						</div>
					</div>
					<div class="grid gap-4">
						<div class="grid gap-3">
							<Label
								for="password"
								class={password === "" ? "text-red-500" : ""}>Password</Label
							>
							<Input
								id="password"
								class={password === "" ? "border-red-500" : ""}
								bind:value={password}
								name="Password"
								type="password"
							/>
						</div>
					</div>
					<Dialog.Footer>
						<Button
							onclick={() => {
								if (!username || !password) return;
								const user = getUser();

								user.create(username, password, (ack) => {
									// @ts-expect-error
									if (ack.err) return;
									user.auth(username, password, (a) => {
										// @ts-expect-error
										if (a.err) return;
										window.location.replace("/chat");
									});
								});
							}}>Register</Button
						>
						<Button
							onclick={() => {
								if (!username || !password) return;
								const user = getUser();

								user.auth(username, password, (a) => {
									// @ts-expect-error
									if (a.err) return;
									window.location.replace("/chat");
								});
							}}
							variant="secondary">Login</Button
						>
					</Dialog.Footer>
				</Dialog.Content>
			</form>
		</Dialog.Root>
	{:else}
		<GunAvatar pub={gunData.user.pub} avatarSource={gunData.user.avatar} class="rounded-full h-12" />
		<p class="ml-3 text-lg">{gunData.user.alias}</p>
	{/if}
</nav>
