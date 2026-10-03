<script lang="ts">
	import { onMount, tick } from 'svelte';

	import { readAnalyticsConsent, setAnalyticsConsent } from '../../../analytics/analytics';
	import { m } from '../../../i18n/paraglide/messages';
	import { consentPanel } from './consent-panel.svelte';

	let choice = $state<boolean | undefined>(undefined);
	let panel = $state<HTMLElement>();

	onMount(() => {
		choice = readAnalyticsConsent();
		consentPanel.available = true;
		if (choice === undefined) consentPanel.show();
		return () => {
			consentPanel.available = false;
			consentPanel.open = false;
		};
	});

	// Reopened from the document menu, the panel takes the focus that menu leaves behind.
	$effect(() => {
		if (consentPanel.open && consentPanel.opener !== undefined)
			void tick().then(() => panel?.focus());
	});

	function saveChoice(allow: boolean): void {
		setAnalyticsConsent(allow);
		choice = allow;
		consentPanel.close();
	}

	/** A choice already made can be kept as is from inside the panel; a pending one must be made. */
	function dismiss(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || choice === undefined) return;
		if (consentPanel.open && panel?.contains(document.activeElement) === true) consentPanel.close();
	}
</script>

<svelte:window onkeydown={dismiss} />

<section
	bind:this={panel}
	id="analytics-consent-panel"
	hidden={!consentPanel.open}
	class="panel print:hidden"
	aria-labelledby="analytics-consent-title"
	tabindex="-1"
>
	<h2 id="analytics-consent-title">{m.common_analytics_title()}</h2>
	<p>{m.common_analytics_intro()}</p>
	<h3>{m.common_analytics_consent_heading()}</h3>
	<p>{m.common_analytics_consent()}</p>
	<h3>{m.common_analytics_always_heading()}</h3>
	<p>{m.common_analytics_always()}</p>
	{#if choice !== undefined}
		<p class="current-choice">
			{#if choice}
				{m.common_analytics_choice_accepted()}
			{:else}
				{m.common_analytics_choice_refused()}
			{/if}
		</p>
	{/if}
	<div class="choices">
		<button
			class="ui-action quiet"
			type="button"
			onclick={() => {
				saveChoice(true);
			}}
		>
			{m.common_analytics_accept()}
		</button>
		<button
			class="ui-action quiet"
			type="button"
			onclick={() => {
				saveChoice(false);
			}}
		>
			{m.common_analytics_refuse()}
		</button>
	</div>
</section>

<style>
	.panel {
		position: fixed;
		z-index: 50;
		bottom: 1rem;
		left: 1rem;
		width: min(22rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		border: 1px solid var(--ui-border);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--ui-surface);
		color: var(--ui-text);
		box-shadow: var(--ui-shadow);
		font-size: 0.875rem;
	}
	.panel h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.panel h3 {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.panel h3 + p {
		margin-top: 0.25rem;
	}
	.panel p {
		margin: 0.5rem 0 0;
		line-height: 1.45;
	}
	.panel .current-choice {
		color: var(--ui-muted);
		font-size: 0.8125rem;
	}
	.choices {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.875rem;
	}
	.choices :global(.ui-action) {
		flex: 1;
		justify-content: center;
	}
</style>
