<script lang="ts">
	import Reply from "lucide-svelte/icons/reply";
	import Pencil from "lucide-svelte/icons/pencil";
	import Copy from "lucide-svelte/icons/copy";
	import { gunData } from "$lib/gun/Gun.svelte";
	import type { MessageFormatted } from "$lib/gun";

	let {
		message,
		onclose,
		onreply,
		onedit
	}: {
		message?: MessageFormatted;
		onclose: () => void;
		onreply: (message: MessageFormatted) => void;
		onedit: (message: MessageFormatted) => void;
	} = $props();

	const canEdit = $derived(
		!!message && message.author.pub === gunData.user?.pub
	);

	async function copyMessage() {
		if (!message) return;

		try {
			await navigator.clipboard.writeText(message.content);
		} catch {
			// clipboard access can be denied
		}

		onclose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && message) onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if message}
	<div class="fixed inset-0 z-[90] flex items-end">
		<button
			type="button"
			class="absolute inset-0 bg-black/60 backdrop-blur-sm"
			aria-label="Close message actions"
			onclick={onclose}
		></button>

		<div
			class="relative z-10 w-full rounded-t-2xl border-t border-white/10 bg-panel shadow-2xl"
			style:padding-bottom="max(1rem, env(safe-area-inset-bottom))"
			role="dialog"
			aria-modal="true"
			aria-label="Message actions"
			tabindex="-1"
		>
			<div class="flex justify-center pb-2 pt-3">
				<div class="h-1 w-10 rounded-full bg-white/20"></div>
			</div>

			<div class="px-2 pb-2">
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-hover"
					onclick={() => {
						onreply(message);
						onclose();
					}}
				>
					<Reply class="h-5 w-5 text-ink-muted" />
					Reply
				</button>

				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-hover"
					onclick={copyMessage}
				>
					<Copy class="h-5 w-5 text-ink-muted" />
					Copy text
				</button>

				{#if canEdit}
					<button
						type="button"
						class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-hover"
						onclick={() => {
							onedit(message);
							onclose();
						}}
					>
						<Pencil class="h-5 w-5 text-ink-muted" />
						Edit message
					</button>
				{/if}
			</div>

			<div class="px-2 pb-2">
				<button
					type="button"
					class="w-full rounded-lg py-3 text-sm font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink"
					onclick={onclose}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
