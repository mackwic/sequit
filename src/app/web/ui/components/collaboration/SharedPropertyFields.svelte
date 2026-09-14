<script lang="ts">
	import { readSharedCommand } from '../../../../../lib/infrastructure/collaboration/shared-command-codec';
	import {
		SharedCommandKind,
		type SharedDocumentCommand,
		type SharedTarget,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	let {
		target,
		properties,
		connected,
		dispatch,
		disabledFields = [],
	}: {
		target: SharedTarget;
		properties: Readonly<Record<string, string | undefined>>;
		connected: boolean;
		dispatch: (command: SharedDocumentCommand) => void;
		disabledFields?: readonly string[];
	} = $props();
	const labels: Readonly<Record<string, string>> = {
		color: 'Couleur',
		icon: 'Icône',
		groupId: 'Groupe',
		natureId: 'Nature',
		operator: 'Opérateur',
		from: 'Origine',
		to: 'Destination',
	};
	let error = $state('');
	function update(key: string, value: string): void {
		let set: Readonly<Record<string, string>> = { [key]: value };
		let unset: readonly string[] = [];
		if (value === '') {
			set = {};
			unset = [key];
		}
		try {
			const command = readSharedCommand({ op: SharedCommandKind.Update, target, set, unset });
			dispatch(command);
			error = '';
		} catch (cause) {
			error = String(cause);
		}
	}
</script>

{#each Object.entries(properties) as [key, value] (key)}
	<label
		>{labels[key] ?? key}<input
			aria-label={`${labels[key] ?? key} de ${target.id}`}
			disabled={!connected || disabledFields.includes(key)}
			value={value ?? ''}
			onchange={(event) => {
				update(key, event.currentTarget.value);
			}}
		/></label
	>
{/each}
{#if error}<p role="alert">{error}</p>{/if}

<style>
	label {
		display: grid;
		grid-template-columns: 75px 1fr;
		align-items: center;
		gap: 5px;
		font-size: 12px;
	}
	input {
		min-width: 0;
		border: 1px solid #d6d3d1;
		border-radius: 4px;
		padding: 5px;
	}
</style>
