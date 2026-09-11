<script module lang="ts">
	import './source-code.css';

	import typescript from 'highlight.js/lib/languages/typescript';
	import { createLowlight } from 'lowlight';

	const highlighter = createLowlight({ typescript });
	type Tokens = ReturnType<typeof highlighter.highlight>['children'];
	interface TextToken {
		text: string;
		className: string;
	}

	function textTokens(nodes: Tokens, className = ''): TextToken[] {
		return nodes.flatMap((node) => {
			if (node.type === 'text') return [{ text: node.value, className }];
			if (node.type !== 'element') return [];
			const classes = node.properties.className;
			let ownClasses = '';
			if (Array.isArray(classes)) ownClasses = classes.join(' ');
			return textTokens(node.children, `${className} ${ownClasses}`.trim());
		});
	}
</script>

<script lang="ts">
	let { source }: { source: string } = $props();
	const tokens = $derived(textTokens(highlighter.highlight('typescript', source).children));
</script>

<pre><code class="hljs language-typescript"
		>{#each tokens as token, index (index)}<span class={token.className}>{token.text}</span
			>{/each}</code
	></pre>
