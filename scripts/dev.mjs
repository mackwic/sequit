import { createServer } from 'node:net';

import concurrently from 'concurrently';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_PORT = 65_535;
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'];

function readWebPort() {
	const value = process.env['PORT'];
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
		throw new Error(`Portless must provide a valid PORT; received ${String(value)}`);
	}
	return port;
}

function requestAvailablePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once('error', reject);
		server.listen(0, LOOPBACK_HOST, () => {
			const address = server.address();
			if (address === null || typeof address === 'string') {
				server.close();
				reject(new Error('Could not determine the collaboration server port'));
				return;
			}
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

async function findCollaborationPort(webPort) {
	let port = await requestAvailablePort();
	while (port === webPort) port = await requestAvailablePort();
	return port;
}

const webPort = readWebPort();
const collaborationPort = await findCollaborationPort(webPort);
const sharedEnvironment = {
	COLLABORATION_PORT: String(collaborationPort),
};
let stopping = false;
for (const signal of STOP_SIGNALS) {
	process.once(signal, () => {
		stopping = true;
	});
}

const { result } = concurrently(
	[
		{
			command: `pnpm exec vite dev --port ${webPort} --strictPort`,
			env: sharedEnvironment,
			name: 'web',
		},
		{
			command: `pnpm exec wrangler dev --config workers/collaboration/wrangler.jsonc --port ${collaborationPort}`,
			env: sharedEnvironment,
			name: 'collaboration',
		},
	],
	{
		killOthersOn: ['failure', 'success'],
		prefix: 'name',
		prefixColors: ['blue', 'magenta'],
	},
);

try {
	await result;
} catch {
	if (!stopping) process.exitCode = 1;
}
