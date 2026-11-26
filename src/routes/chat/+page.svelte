<script lang="ts">
	import MessageCircle from "lucide-svelte/icons/message-circle";
</script>

<div class="flex h-full flex-col items-center justify-center bg-app px-6 text-center">
	<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-panel">
		<MessageCircle class="h-6 w-6 text-ink-muted" />
	</div>
	<p class="text-lg font-semibold text-ink">No conversation selected</p>
	<p class="mt-1 max-w-sm text-sm text-ink-muted">
		Choose a friend from the sidebar or add someone new to start chatting.
	</p>
	<a href="/friend-requests" class="mt-4 text-sm font-medium text-blurple hover:underline">
		Add friends
	</a>
</div>
