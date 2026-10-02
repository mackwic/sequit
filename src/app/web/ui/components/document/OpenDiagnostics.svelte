<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import type { OpenDocumentResult } from '../../../projection/open-document';
	import Icon from '../ui/Icon.svelte';

	type Diagnostics = Extract<OpenDocumentResult, { ok: false }>['diagnostics'];

	let { name, diagnostics }: { name: string; diagnostics: Diagnostics } = $props();

	function location(diagnostic: Diagnostics[number]): string {
		if (diagnostic.line === undefined) return diagnostic.path.join('.');
		return m.document_diagnostics_line({ line: diagnostic.line });
	}
</script>

<div class="ui-notice error" role="alert">
	<Icon name="phosphor:warning-circle" />
	<div>
		<p class="m-0 font-semibold">{m.document_diagnostics_invalid({ name })}</p>
		<ul class="m-0 mt-1 list-disc pl-5">
			{#each diagnostics as diagnostic, index (index)}
				<li>{diagnostic.message} <span class="opacity-70">({location(diagnostic)})</span></li>
			{/each}
		</ul>
	</div>
</div>
