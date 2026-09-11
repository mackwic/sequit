import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (import.meta.env.DEV) {
		const { readDocument } = await import('../../../../app/workshop/glossary/storage');
		return json({ document: await readDocument() }, { headers: { 'cache-control': 'no-store' } });
	}
	error(404, 'Not found');
};

export const PUT: RequestHandler = async ({ request, url }) => {
	if (import.meta.env.DEV) {
		if (request.headers.get('origin') !== url.origin) error(403, 'Origine non autorisée.');
		const body: unknown = await request.json();
		if (typeof body !== 'object' || body === null || !('base' in body) || !('document' in body))
			error(400, 'Requête invalide.');
		if (
			typeof body.base !== 'string' ||
			typeof body.document !== 'string' ||
			body.document.length > 500_000
		)
			error(400, 'Document invalide.');
		const { saveDocument } = await import('../../../../app/workshop/glossary/storage');
		await saveDocument(body.base, body.document);
		return json({ saved: true });
	}
	error(404, 'Not found');
};
