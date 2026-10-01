<script lang="ts">
	let {
		label,
		checked,
		disabled = false,
		onchange,
	}: {
		label: string;
		checked: boolean;
		disabled?: boolean;
		onchange: (checked: boolean) => void;
	} = $props();
	const id = $props.id();
</script>

<div class="row">
	<span class="label" id={`toggle-label-${id}`}>{label}</span>
	<button
		class="switch"
		type="button"
		role="switch"
		aria-checked={checked}
		aria-labelledby={`toggle-label-${id}`}
		{disabled}
		onclick={() => {
			onchange(!checked);
		}}
	>
		<span class="thumb"></span>
	</button>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.label {
		font-size: 14px;
		font-weight: 550;
	}
	.switch {
		display: inline-flex;
		align-items: center;
		flex: none;
		width: 42px;
		height: 24px;
		padding: 2px;
		border: 1px solid var(--ui-border);
		border-radius: 999px;
		background: var(--ui-subtle);
		cursor: pointer;
		transition:
			background-color 120ms ease-out,
			border-color 120ms ease-out;
	}
	.switch[aria-checked='true'] {
		border-color: var(--ui-accent);
		background: var(--ui-accent);
	}
	.switch:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.switch:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	.thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--ui-text);
		transition: transform 120ms ease-out;
	}
	.switch[aria-checked='true'] .thumb {
		background: var(--ui-on-accent);
		transform: translateX(18px);
	}
	@media (prefers-reduced-motion: reduce) {
		.switch,
		.thumb {
			transition: none;
		}
	}
</style>
