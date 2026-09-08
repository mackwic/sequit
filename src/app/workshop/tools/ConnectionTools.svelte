<script lang="ts">
	import { onDestroy, tick } from 'svelte';

	import Icon from '../../web/ui/components/ui/Icon.svelte';
	import type { WorkbenchToolProps } from '../workshop-types';
	let { workbench, model, presentation, viewport, canvas, session, report }: WorkbenchToolProps =
		$props();
	let from = $state('');
	let cancelDrag: () => void = () => undefined;
	let line = $state<{ x1: number; y1: number; x2: number; y2: number }>();
	onDestroy(() => {
		cancelDrag();
	});
	let to = $state('');
	let connecting = $state(false);
	let relation = $state('');
	let ports = $state<{ id: string; x: number; y: number }[]>([]);
	async function connect() {
		if (!from || !to) return;
		try {
			if (relation) workbench.commands.retargetRelation({ id: relation, from, to });
			else await workbench.commands.addRelation({ id: `rel-${crypto.randomUUID()}`, from, to });
			connecting = false;
			report('Relation validée. Le sens est indiqué par la flèche.');
		} catch (error) {
			report(String(error), true);
		}
	}
	$effect(() => {
		const area = viewport;
		if (!area || !canvas) return;
		const zoom = session.zoom;
		const update = () => {
			const parent =
				area.closest('.workbench')?.getBoundingClientRect() ?? area.getBoundingClientRect();
			ports = [...area.querySelectorAll<HTMLElement>('[data-node-id]')].map((node) => {
				const bounds = node.getBoundingClientRect();
				return {
					id: node.dataset['nodeId'] ?? '',
					x: bounds.left + (node.offsetWidth * zoom) / 2 - parent.left,
					y: bounds.bottom - parent.top,
				};
			});
		};
		void tick().then(update);
		area.addEventListener('scroll', update);
		window.addEventListener('resize', update);
		return () => {
			area.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		};
	});
	$effect(() => {
		const area = viewport;
		if (!area || !connecting || line) return;
		const pick = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) return;
			const id = event.target.closest('[data-node-id]')?.getAttribute('data-node-id');
			if (id == null || id === '') return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!from) {
				from = id;
				report('Source choisie. Cliquez maintenant sur la cible.');
			} else {
				to = id;
				void connect();
			}
		};
		area.addEventListener('click', pick, true);
		return () => {
			area.removeEventListener('click', pick, true);
		};
	});
	function drag(event: PointerEvent, id: string) {
		if (event.button !== 0) return;
		event.preventDefault();
		cancelDrag();
		line = { x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY };
		from = id;
		to = '';
		connecting = true;
		const move = (next: PointerEvent) => {
			if (line) line = { ...line, x2: next.clientX, y2: next.clientY };
		};
		const up = (next: PointerEvent) => {
			cancelDrag();
			const target = document
				.elementFromPoint(next.clientX, next.clientY)
				?.closest('[data-node-id]')
				?.getAttribute('data-node-id');
			if (target != null && target !== '') {
				to = target;
				void connect();
			}
		};
		cancelDrag = () => {
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointercancel', cancelDrag);
			line = undefined;
			connecting = false;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointercancel', cancelDrag, { once: true });
		window.addEventListener('pointerup', up, { once: true });
	}
	function cancel(event: KeyboardEvent) {
		if (event.key === 'Escape' && (connecting || line)) {
			event.preventDefault();
			cancelDrag();
			connecting = false;
			from = '';
			to = '';
		}
	}
</script>

<svelte:window onkeydown={cancel} />
<div class="wb-tools">
	<h2>Relier des idées</h2>
	<label
		>Relation à modifier<select
			bind:value={relation}
			onchange={() => {
				const current = model.relations.find((item) => item.id === relation);
				from = current?.from ?? '';
				to = current?.to ?? '';
			}}
			><option value="">Nouvelle relation</option>{#each model.relations as item (item.id)}<option
					value={item.id}>{item.from} → {item.to}</option
				>{/each}</select
		></label
	>
	<div class="wb-row">
		<label
			>Source<select aria-label="Source" bind:value={from}
				><option value="">Choisir…</option>{#each model.nodes as node (node.id)}<option
						value={node.id}>{node.markdown}</option
					>{/each}</select
			></label
		><label
			>Cible<select aria-label="Cible" bind:value={to}
				><option value="">Choisir…</option>{#each model.nodes as node (node.id)}<option
						value={node.id}>{node.markdown}</option
					>{/each}</select
			></label
		>
	</div>
	<button class="primary" type="button" disabled={!from || !to} onclick={() => void connect()}
		><Icon name="phosphor:check" /> Valider la relation</button
	>{#if presentation === 'two-step'}<button
			type="button"
			aria-pressed={connecting}
			onclick={() => {
				from = '';
				to = '';
				connecting = true;
				report('Cliquez sur une source, puis une cible.');
			}}><Icon name="phosphor:cursor" /> Choisir dans le canvas</button
		>{:else}<p>
			Glissez une poignée violette vers une boîte cible. Les listes offrent aussi un accès clavier.
		</p>{/if}
	<div class="wb-row">
		<button
			type="button"
			onclick={() => {
				cancelDrag();
				connecting = false;
				from = '';
				to = '';
			}}><Icon name="phosphor:x" /> Annuler le tracé</button
		><button
			type="button"
			disabled={!relation}
			onclick={() => {
				workbench.commands.removeRelation(relation);
				relation = '';
				report('Relation supprimée.');
			}}><Icon name="phosphor:trash" /> Supprimer</button
		>
	</div>
</div>
{#if presentation === 'handles'}<div class="ports">
		{#each ports as port (port.id)}<button
				type="button"
				aria-label={`Connecter depuis ${port.id}`}
				title="Glisser vers une cible"
				style:left={`${port.x}px`}
				style:top={`${port.y}px`}
				onpointerdown={(event) => {
					drag(event, port.id);
				}}
				onclick={(event) => {
					if (event.detail !== 0) return;
					from = port.id;
					connecting = true;
				}}
			></button>{/each}
	</div>{/if}

{#if line}<svg aria-hidden="true" class="connection-preview"
		><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} /></svg
	>{/if}

<style>
	.connection-preview {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		pointer-events: none;
		z-index: 45;
	}
	.connection-preview line {
		stroke: #6f70e8;
		stroke-width: 2;
		stroke-dasharray: 6 4;
	}
	.ports {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 32;
	}
	.ports button {
		pointer-events: auto;
		position: absolute;
		transform: translate(-50%, -50%);
		width: 15px;
		height: 15px;
		border: 3px solid white;
		box-shadow: 0 0 0 1px #6f70e8;
		border-radius: 50%;
		background: #6f70e8;
		cursor: crosshair;
	}
	.ports button:focus-visible {
		outline: 3px solid #292524;
		outline-offset: 3px;
	}
</style>
