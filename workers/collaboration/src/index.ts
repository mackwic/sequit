export { CollaborationRoom } from './collaboration-room';

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
