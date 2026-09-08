<script lang="ts">
	import Icon from '../web/ui/components/ui/Icon.svelte';
	let {
		content,
		filename,
		label = 'Télécharger',
	}: { content: string; filename: string; label?: string } = $props();
	function download() {
		const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		setTimeout(() => {
			URL.revokeObjectURL(url);
		}, 1000);
	}
</script>

<button class="ui-action" type="button" onclick={download}
	><Icon name="phosphor:download-simple" />{label}</button
>
