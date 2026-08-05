import { DurableObject } from 'cloudflare:workers';

interface Env {
	COLLABORATION_ROOMS: DurableObjectNamespace<CollaborationRoom>;
}

const json = (body: unknown, status = 200) =>
	Response.json(body, {
		status,
		headers: { 'cache-control': 'no-store' },
	});

export default {
	fetch(request, env): Response | Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return json({ status: 'ok' });
		}

		const isCollaborationRoomPath = /^\/collab\/[^/]+$/.test(url.pathname);
		if (!isCollaborationRoomPath) {
			return json({ error: 'Not found' }, 404);
		}

		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
			return json({ error: 'WebSocket upgrade required' }, 426);
		}

		const roomId = decodeURIComponent(url.pathname.slice('/collab/'.length));
		const room = env.COLLABORATION_ROOMS.getByName(roomId);
		return room.fetch(request);
	},
} satisfies ExportedHandler<Env>;

export class CollaborationRoom extends DurableObject<Env> {
	override fetch(request: Request): Response {
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
			return json({ error: 'WebSocket upgrade required' }, 426);
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		this.ctx.acceptWebSocket(server);
		server.send(JSON.stringify({ type: 'ready' }));

		return new Response(null, { status: 101, webSocket: client });
	}

	override webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
		if (typeof message === 'string') {
			try {
				const payload: unknown = JSON.parse(message);
				if (
					typeof payload === 'object' &&
					payload !== null &&
					'type' in payload &&
					payload.type === 'ping'
				) {
					socket.send(JSON.stringify({ type: 'pong' }));
					return;
				}
			} catch {
				// Non-JSON payloads are valid collaboration messages.
			}
		}

		for (const peer of this.ctx.getWebSockets()) {
			if (peer !== socket) {
				peer.send(message);
			}
		}
	}

	override webSocketClose(socket: WebSocket, code: number, reason: string): void {
		socket.close(code, reason);
	}
}
