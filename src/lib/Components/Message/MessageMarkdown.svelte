<script lang="ts">
	import type { MarkdownInline } from "$lib/markdown";
	import { parseMarkdown } from "$lib/markdown";
	import MessageSpoiler from "./MessageSpoiler.svelte";

	let { content }: { content: string } = $props();

	const blocks = $derived(parseMarkdown(content));

	const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
		1: "text-2xl font-semibold",
		2: "text-xl font-semibold",
		3: "text-lg font-semibold",
		4: "text-base font-semibold"
	};
</script>

{#snippet inline(nodes: MarkdownInline[])}
	{#each nodes as node}
		{#if node.type === "text"}
			{node.value}
		{:else if node.type === "bold"}
			<strong class="font-bold">{@render inline(node.children)}</strong>
		{:else if node.type === "italic"}
			<em>{@render inline(node.children)}</em>
		{:else if node.type === "underline"}
			<span class="underline">{@render inline(node.children)}</span>
		{:else if node.type === "strike"}
			<span class="line-through">{@render inline(node.children)}</span>
		{:else}
			<MessageSpoiler>{@render inline(node.children)}</MessageSpoiler>
		{/if}
	{/each}
{/snippet}

<div class="min-w-0 space-y-1">
	{#each blocks as block}
		{#if block.type === "codeblock"}
			<pre
				class="overflow-x-auto rounded-md border border-black/25 bg-rail px-3 py-2 font-mono text-[13px] leading-5 text-ink-soft"><code>{block.value}</code></pre>
		{:else if block.type === "heading"}
			<svelte:element
				this={`h${block.level}`}
				class={`break-words leading-tight text-ink ${HEADING_CLASS[block.level]}`}
			>{@render inline(block.children)}</svelte:element>
		{:else}
			<div class="whitespace-pre-wrap break-words">{@render inline(block.children)}</div>
		{/if}
	{/each}
</div>
