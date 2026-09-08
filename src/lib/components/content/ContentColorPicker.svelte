<script lang="ts">
	import { contentPalette } from '$lib/content/content-palette';

	import Icon from '../ui/Icon.svelte';
	let { value, onchange }: { value: string; onchange: (value: string) => void } = $props();
	let hex = $derived.by(() => {
		if (value.length === 4)
			return value.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3');
		return value;
	});
	const shades = ['clair', 'moyen', 'intense'];
</script>

<div class="color-control">
	<label class="custom"
		>Couleur personnalisée
		<input
			type="color"
			aria-label="Couleur personnalisée"
			value={hex}
			onchange={(event) => {
				onchange(event.currentTarget.value);
			}}
		/>
		<code>{value.toUpperCase()}</code>
	</label>
	<details>
		<summary><Icon name="phosphor:palette" /> Palette · 54 couleurs</summary>
		<div class="palette" role="group" aria-label="Palette content">
			{#each contentPalette as family (family.label)}
				<div class="family">
					<span>{family.label}</span>
					<div class="shades">
						{#each family.colors as color, index (color)}
							<button
								type="button"
								class="swatch"
								aria-label={`${family.label} ${shades[index]}`}
								title={`${family.label} ${shades[index]} · ${color}`}
								aria-pressed={value.toLowerCase() === color}
								style:--swatch={color}
								onclick={() => {
									onchange(color);
								}}><span></span></button
							>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</details>
</div>

<style>
	.color-control {
		display: grid;
		gap: 9px;
	}
	.custom {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 11px;
	}
	.custom input {
		width: 42px;
		height: 30px;
		border: 1px solid var(--ui-border);
		padding: 2px;
		border-radius: 5px;
	}
	code {
		font-size: 11px;
		color: var(--ui-muted);
	}
	details {
		border-top: 1px solid var(--ui-border);
		padding-top: 9px;
	}
	summary {
		cursor: pointer;
		font-size: 11px;
		color: var(--ui-muted);
	}
	.palette {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px 12px;
		padding-top: 12px;
	}
	.family > span {
		font-size: 10px;
		color: var(--ui-muted);
	}
	.shades {
		display: flex;
		gap: 4px;
	}
	.swatch {
		width: 30px;
		height: 30px;
		padding: 3px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: var(--ui-surface);
		cursor: pointer;
	}
	.swatch span {
		display: block;
		width: 100%;
		height: 100%;
		background: var(--swatch);
		border: 1px solid #0002;
		border-radius: 3px;
	}
	.swatch[aria-pressed='true'] {
		border: 2px solid var(--ui-accent);
	}
	.swatch:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
</style>
