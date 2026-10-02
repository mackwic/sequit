<script lang="ts">
	import { readSharedCommand } from '../../../../../lib/infrastructure/collaboration/shared-command-codec';
	import {
		SharedCommandKind,
		type SharedDocumentCommand,
		type SharedTarget,
	} from '../../../../../lib/infrastructure/document/shared-document-command';
	import { m } from '../../../i18n/paraglide/messages';
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
	const labels: Readonly<Record<string, () => string>> = {
		color: () => m.collaboration_property_color(),
		icon: () => m.collaboration_property_icon(),
		groupId: () => m.collaboration_property_group_id(),
		natureId: () => m.collaboration_property_nature_id(),
		operator: () => m.collaboration_property_operator(),
		from: () => m.collaboration_property_from(),
		to: () => m.collaboration_property_to(),
	};
	const ariaLabels: Readonly<Record<string, (id: string) => string>> = {
		color: (id) => m.collaboration_property_color_aria({ id }),
		icon: (id) => m.collaboration_property_icon_aria({ id }),
		groupId: (id) => m.collaboration_property_group_id_aria({ id }),
		natureId: (id) => m.collaboration_property_nature_id_aria({ id }),
		operator: (id) => m.collaboration_property_operator_aria({ id }),
		from: (id) => m.collaboration_property_from_aria({ id }),
		to: (id) => m.collaboration_property_to_aria({ id }),
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
		>{labels[key]?.() ?? key}<input
			aria-label={ariaLabels[key]?.(target.id) ?? key}
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
