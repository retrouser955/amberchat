<script lang="ts">
	import Rocket from "lucide-svelte/icons/rocket";
	import LogOut from "lucide-svelte/icons/log-out";
	import ShieldCheck from "lucide-svelte/icons/shield-check";
	import favicon from "$lib/assets/favicon.svg";
	import * as Dialog from "../ui/dialog";
	import { Button, buttonVariants } from "../ui/button";
	import { Label } from "../ui/label";
	import { Input } from "../ui/input";
	import { getUser, gunData, logout } from "$lib/gun/Gun.svelte";
	import { goto } from "$app/navigation";
	import GunAvatar from "../GunAvatar/GunAvatar.svelte";
	import { displayNameOf } from "$lib/profile";

	let username = $state<string>("");
	let password = $state<string>("");
	let authError = $state<string>();
</script>

<nav
	class="flex h-14 w-full shrink-0 items-center gap-3 border-b border-black/40 bg-rail px-3 sm:px-4"
>
	<a href={gunData.user ? "/chat" : "/"} class="group flex items-center gap-2.5 rounded-md px-1 py-1">
		<img src={favicon} alt="AmberChat logo" class="h-8 w-8 rounded-lg" />
		<span class="text-[15px] font-semibold tracking-tight text-ink group-hover:text-white">
			Amber
		</span>
	</a>

	<span
		class="hidden items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink-muted sm:flex"
	>
		<ShieldCheck class="h-3.5 w-3.5 text-positive" />
		End-to-end encrypted
	</span>

	<div class="ml-auto flex items-center gap-2">
		{#if !gunData.user}
			<Dialog.Root>
				<Dialog.Trigger class={buttonVariants({ variant: "default", size: "sm" })}>
					<Rocket class="h-4 w-4" />
					<span>Get started</span>
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title class="text-xl font-semibold text-ink">Welcome to Amber</Dialog.Title>
						<Dialog.Description>
							Create a new account or sign in to start messaging privately.
						</Dialog.Description>
					</Dialog.Header>

					<div class="mt-2 grid gap-4">
						<div class="grid gap-2">
							<Label for="username">Username</Label>
							<Input
								id="username"
								class="h-10 border-black/30 bg-rail/60 dark:bg-rail/60"
								bind:value={username}
								name="username"
								autocomplete="username"
								placeholder="your-username"
							/>
						</div>
						<div class="grid gap-2">
							<Label for="password">Password</Label>
							<Input
								id="password"
								class="h-10 border-black/30 bg-rail/60 dark:bg-rail/60"
								bind:value={password}
								name="password"
								type="password"
								autocomplete="current-password"
								placeholder="••••••••"
							/>
						</div>
					</div>

					{#if authError}
						<p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{authError}
						</p>
					{/if}

					<Dialog.Footer class="mt-1">
						<Button
							onclick={() => {
								if (!username || !password) return;
								const user = getUser();

								authError = undefined;

								user.create(username, password, (ack) => {
									if ("err" in ack) {
										authError = ack.err;
										return;
									}

									user.auth(username, password, (a) => {
										if ("err" in a) {
											authError = a.err;
											return;
										}

										window.location.replace("/chat");
									});
								});
							}}>Register</Button
						>
						<Button
							onclick={() => {
								if (!username || !password) return;
								const user = getUser();

								authError = undefined;

								user.auth(username, password, (a) => {
									if ("err" in a) {
										authError = a.err;
										return;
									}

									window.location.replace("/chat");
								});
							}}
							variant="secondary">Login</Button
						>
					</Dialog.Footer>
				</Dialog.Content>
			</Dialog.Root>
		{:else}
			<div class="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5">
				<a
					href="/profile"
					title="Edit profile"
					class="flex min-w-0 items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-white/5"
				>
					<GunAvatar
						pub={gunData.user.pub}
						avatarSource={gunData.user.avatar}
						class="h-8 w-8 rounded-full"
					/>
					<div class="hidden min-w-0 sm:block">
						<p class="max-w-36 truncate text-[13px] font-medium leading-tight text-ink">
							{displayNameOf(gunData.user)}
						</p>
						<p class="text-[10px] leading-tight text-ink-muted">View profile</p>
					</div>
				</a>
				<button
					type="button"
					title="Log out"
					aria-label="Log out"
					class="ml-1 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
					onclick={() => {
						logout();
						goto("/");
					}}
				>
					<LogOut class="h-4 w-4" />
				</button>
			</div>
		{/if}
	</div>
</nav>
