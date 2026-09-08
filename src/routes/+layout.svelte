<script lang="ts">
	import './layout.css';

	import favicon from '../app/web/ui/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#fafaf9" />
</svelte:head>
{@render children()}
