<script lang="ts">
	import { onMount } from 'svelte';

	type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

	let connectionStatus = $state<ConnectionStatus>('connecting');
	let statusLabel = $derived(
		connectionStatus === 'connected'
			? 'Local collaboration ready'
			: connectionStatus === 'disconnected'
				? 'Collaboration offline'
				: 'Connecting'
	);

	onMount(() => {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(`${protocol}//${window.location.host}/collab/local-demo`);

		socket.addEventListener('message', (event) => {
			if (typeof event.data !== 'string') return;

			try {
				const message: unknown = JSON.parse(event.data);
				if (typeof message !== 'object' || message === null || !('type' in message)) return;

				if (message.type === 'ready') {
					socket.send(JSON.stringify({ type: 'ping' }));
				}

				if (message.type === 'pong') {
					connectionStatus = 'connected';
				}
			} catch {
				connectionStatus = 'disconnected';
			}
		});

		socket.addEventListener('error', () => {
			connectionStatus = 'disconnected';
		});

		socket.addEventListener('close', () => {
			connectionStatus = 'disconnected';
		});

		return () => socket.close(1000, 'Page closed');
	});
</script>

<div
	class="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600"
	data-status={connectionStatus}
>
	<span
		class:animate-pulse={connectionStatus === 'connecting'}
		class="size-2 rounded-full"
		class:bg-amber-400={connectionStatus === 'connecting'}
		class:bg-emerald-500={connectionStatus === 'connected'}
		class:bg-rose-500={connectionStatus === 'disconnected'}
	></span>
	{statusLabel}
</div>
