<script lang="ts">
	import { bodyMarkdown } from '../../../../../lib/infrastructure/content/body-markdown';
	let { markdown }: { markdown: string } = $props();
	const spans = $derived(bodyMarkdown(markdown));
</script>

{#each spans as span, index (index)}<span
		class:strong={span.strong}
		class:emphasis={span.emphasis}
		class:underline={span.underline}>{span.text}</span
	>{/each}

<style>
	.strong {
		font-weight: 700;
	}
	.emphasis {
		font-style: italic;
	}
	.underline {
		text-decoration: underline;
	}
</style>
