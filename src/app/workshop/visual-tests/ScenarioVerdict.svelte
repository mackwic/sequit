<script lang="ts">
	import { VisualAssertionError } from '../../../../tests/support/assertions/assertion-error';

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
			{#if error.context?.axis}<p>Axe : {error.context.axis.toUpperCase()}</p>{/if}
			{#if error.context?.difference !== undefined}<p>Écart : {error.context.difference}</p>{/if}
			{#if error.context?.tolerance !== undefined}<p>
					Tolérance : {error.context.tolerance} unité de layout
				</p>{/if}
		{:else}
			<p class="failure-subject">
				{#if error instanceof Error}{error.message}{:else}{String(error)}{/if}
			</p>
		{/if}
	{:else}
		{verdict}
	{/if}
</div>
