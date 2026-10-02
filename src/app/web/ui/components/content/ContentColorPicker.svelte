<script lang="ts">
	import { m } from '../../../i18n/paraglide/messages';
	import { contentPalette } from '../../content/content-palette';
	let { value, onchange }: { value: string; onchange: (value: string) => void } = $props();
	const shades = [
		m.content_color_picker_shade_light(),
		m.content_color_picker_shade_mid(),
		m.content_color_picker_shade_intense(),
	];
	const shade = (index: number): string => shades[index] ?? '';
	let hex = $derived.by(() => {
		if (value.length === 4)
			return value.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3');
		return value;
	});
	let current = $derived(value.toLowerCase());
	/** The palette entry the value matches, if any; a custom colour names itself. */
	let name = $derived.by(() => {
		for (const family of contentPalette) {
			const index = family.colors.findIndex((color) => color === current);
			if (index !== -1)
				return m.content_color_picker_color_name({ family: family.label, shade: shade(index) });
		}
		return m.content_color_picker_custom();
	});
	let custom = $derived.by(() => !contentPalette.some((family) => family.colors.includes(current)));
</script>

<div class="color-control">
	<div class="swatches" role="group" aria-label={m.content_color_picker_palette_aria()}>
		{#each contentPalette as family (family.label)}
			{#each family.colors as color, index (color)}
				<button
					type="button"
					class="swatch"
					aria-label={m.content_color_picker_swatch_aria({
						family: family.label,
						shade: shade(index),
					})}
					title={m.content_color_picker_swatch_title({
						family: family.label,
						shade: shade(index),
						color,
					})}
					aria-pressed={current === color}
					style:--swatch={color}
					onclick={() => {
						onchange(color);
					}}
				></button>
			{/each}
		{/each}
		<label
			class="swatch custom"
			class:pressed={custom}
			title={m.content_color_picker_custom_title()}
		>
			<input
				type="color"
				aria-label={m.content_color_picker_custom_aria()}
				value={hex}
				oninput={(event) => {
					onchange(event.currentTarget.value);
				}}
			/>
		</label>
	</div>
	<p class="current">
		<span class="dot" style:--swatch={value}></span>{m.content_color_picker_current_value({ name })} ·
		<code>{value.toUpperCase()}</code>
	</p>
</div>

<style>
	.color-control {
		display: grid;
		gap: 8px;
	}
	/* One column per family, three shades down; the custom entry closes the last column. */
	.swatches {
		display: grid;
		grid-template-columns: repeat(19, 1fr);
		grid-auto-flow: column;
		grid-template-rows: repeat(3, auto);
		gap: 5px;
		justify-items: center;
	}
	.swatch {
		position: relative;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid #0002;
		border-radius: 50%;
		background: var(--swatch);
		cursor: pointer;
		transition: transform 80ms ease;
	}
	.swatch:hover {
		transform: scale(1.18);
	}
	.swatch[aria-pressed='true'],
	.swatch.pressed {
		box-shadow:
			0 0 0 2px var(--ui-surface),
			0 0 0 4px var(--ui-accent);
	}
	.custom {
		grid-column: 19;
		grid-row: 2;
		background: conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444);
	}
	.custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.swatch:focus-visible,
	.custom:has(input:focus-visible) {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.current {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		color: var(--ui-muted);
		font-size: 11px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border: 1px solid #0002;
		border-radius: 50%;
		background: var(--swatch);
	}
	code {
		font-size: 11px;
	}
	@media (max-width: 640px) {
		.swatches {
			grid-template-columns: repeat(10, 1fr);
			grid-auto-flow: row;
			grid-template-rows: none;
		}
		.custom {
			grid-column: auto;
			grid-row: auto;
		}
	}
</style>
