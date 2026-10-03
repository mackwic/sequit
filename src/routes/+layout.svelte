<script lang="ts">
	import './layout.css';

	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';

	import { captureAnalyticsPageview, initializeAnalytics } from '../app/web/analytics/analytics';
	import favicon from '../app/web/ui/assets/favicon.svg';
	import AnalyticsConsent from '../app/web/ui/components/ui/AnalyticsConsent.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const analyticsEnabled =
		env['PUBLIC_POSTHOG_ENABLED'] === 'true' || (!dev && env['PUBLIC_POSTHOG_ENABLED'] !== 'false');

	$effect(() => {
		// Track pathname changes even when two documents share the same route template.
		if (!analyticsEnabled || page.url.pathname.startsWith('/atelier')) return;
		initializeAnalytics({
			key: env['PUBLIC_POSTHOG_KEY'] ?? 'phc_mHLtB92hBfRFdG2FAQTDLTz2SPdeBwZX5utdu5kjmV3D',
			host: '/ingest',
		});
		captureAnalyticsPageview(page.route.id);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#fafaf9" />
</svelte:head>
{@render children()}
{#if analyticsEnabled}
	<AnalyticsConsent />
{/if}
