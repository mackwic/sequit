<script lang="ts">
	import Icon from '../web/ui/components/ui/Icon.svelte';
	import { downloadText } from '../web/ui/document/download-text';
	let {
		content,
		filename,
		label = 'Télécharger',
	}: { content: string; filename: string; label?: string } = $props();
</script>

<button
	class="ui-action"
	type="button"
	onclick={() => {
		downloadText(content, filename);
	}}><Icon name="phosphor:download-simple" />{label}</button
>
