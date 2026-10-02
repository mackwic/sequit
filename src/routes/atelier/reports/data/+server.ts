import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (import.meta.env.DEV) {
		const { readPulledFiles } = await import('../../../../app/workshop/layout-reports/storage');
		return json({ files: await readPulledFiles() }, { headers: { 'cache-control': 'no-store' } });
	}
	error(404, 'Not found');
};
