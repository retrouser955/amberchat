<script lang="ts">
	import Users from "lucide-svelte/icons/users";
	import Plus from "lucide-svelte/icons/plus";
	import Link from "lucide-svelte/icons/link";
	import { Button } from "$lib/Components/ui/button";
</script>

<div class="flex h-full items-center justify-center bg-app px-6 text-center">
	<div class="max-w-md">
		<div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04]">
			<Users class="h-8 w-8 text-blurple" />
		</div>
		<h1 class="mt-5 text-2xl font-semibold text-ink">Group chats</h1>
		<p class="mt-2 text-sm text-ink-muted">
			Create an encrypted group with friends, or join one with an invite link.
		</p>
		<div class="mt-6 flex flex-wrap items-center justify-center gap-2">
			<Button href="/groups/new">
				<Plus class="h-4 w-4" />
				New group
			</Button>
			<Button href="/groups/join" variant="secondary">
				<Link class="h-4 w-4" />
				Join with invite
			</Button>
		</div>
	</div>
</div>
