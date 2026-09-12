<script lang="ts">
	import { VisualAssertionError } from './assertion-error';

	let {
		verdict,
		failure,
	}: {
		verdict: string;
		failure: { error: unknown } | null;
	} = $props();
</script>

<div role="status" aria-atomic="true" class="scenario-verdict" class:failure={failure !== null}>
	{#if failure !== null}
		{@const error = failure.error}
		<div class="failure-heading">
			<span aria-hidden="true">×</span><strong>Échec du scénario</strong>
		</div>
		{#if error instanceof VisualAssertionError}
			<p class="failure-subject">{error.subject}</p>
			<dl class="failure-comparison">
				<div>
					<dt>Attendu</dt>
					<dd>{error.expected}</dd>
				</div>
				<div>
					<dt>Observé</dt>
					<dd>{error.actual}</dd>
				</div>
			</dl>
		{:else}
			<p class="failure-subject">
				{#if error instanceof Error}{error.message}{:else}{String(error)}{/if}
			</p>
		{/if}
	{:else}
		{verdict}
	{/if}
</div>
