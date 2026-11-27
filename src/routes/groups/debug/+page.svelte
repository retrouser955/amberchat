<script lang="ts">
	import { onMount } from "svelte";
	import { env } from "$env/dynamic/public";
	import { Button } from "$lib/Components/ui/button";
	import { Input } from "$lib/Components/ui/input";
	import { Label } from "$lib/Components/ui/label";
	import { createGun } from "$lib/gun/Gun.svelte";
	import { groupMemberTag } from "$lib/gun/Group/Group";

	let gid = $state("");
	let member = $state("");
	let epoch = $state("1");
	let busy = $state(false);
	let result = $state<string>();
	let error = $state<string>();

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		gid = params.get("gid") ?? "";
		member = params.get("member") ?? "";
		epoch = params.get("epoch") ?? "1";

		if (gid && member) void inspect();
	});

	async function inspect() {
		busy = true;
		error = undefined;
		result = undefined;

		try {
			const gun = createGun();
			const tag = await groupMemberTag(gid, member);
			const keysNode = await gun
				.get(`groups/${gid}/keys`)
				.get(String(epoch))
				.then();
			const keys =
				keysNode && typeof keysNode === "object"
					? Object.keys(keysNode as Record<string, unknown>).filter(
							(key) => !key.startsWith("_")
						)
					: [];

			const info = {
				relay: env.PUBLIC_GUN_RELAY ?? "http://localhost:3000/gun",
				gid,
				member,
				epoch,
				expectedTag: tag,
				expectedKeyPath: `groups/${gid}/keys/${epoch}/${tag}`,
				keysNodeKeys: keys,
				keyEnvelope: await gun
					.get(`groups/${gid}/keys`)
					.get(String(epoch))
					.get(tag)
					.then(),
				current: await gun.get(`groups/${gid}`).get("current").then(),
				rosterExists: !!(await gun
					.get(`groups/${gid}/roster`)
					.get(String(epoch))
					.then()),
				metaExists: !!(await gun
					.get(`groups/${gid}/meta`)
					.get(String(epoch))
					.then())
			};

			result = JSON.stringify(info, null, 2);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-app">
	<header class="flex h-12 shrink-0 items-center border-b border-black/20 px-4 sm:px-6">
		<h1 class="text-[15px] font-semibold text-ink">Group diagnostics</h1>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
		<div class="mx-auto w-full max-w-3xl space-y-4">
			<section class="space-y-3 rounded-lg border border-white/5 bg-panel p-4 sm:p-5">
				<p class="text-sm text-ink-muted">
					Reads public group nodes only. Open this on both devices and compare the
					output. The expected key path must exist and the envelope must be non-empty.
				</p>

				<div class="grid gap-2">
					<Label for="diag-gid">Group ID</Label>
					<Input id="diag-gid" bind:value={gid} class="h-10 font-mono text-xs" />
				</div>

				<div class="grid gap-2">
					<Label for="diag-member">Member pub</Label>
					<Input id="diag-member" bind:value={member} class="h-10 font-mono text-xs" />
				</div>

				<div class="grid gap-2">
					<Label for="diag-epoch">Epoch</Label>
					<Input id="diag-epoch" bind:value={epoch} class="h-10 font-mono text-xs" />
				</div>

				<div class="flex justify-end">
					<Button disabled={busy || !gid || !member} onclick={inspect}>
						{busy ? "Inspecting…" : "Inspect"}
					</Button>
				</div>

				{#if error}
					<p
						class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{error}
					</p>
				{/if}
			</section>

			{#if result}
				<pre
					class="max-h-[70vh] overflow-auto rounded-lg border border-white/5 bg-rail p-3 text-xs leading-5 text-ink-soft">{result}</pre>
			{/if}
		</div>
	</div>
</div>
