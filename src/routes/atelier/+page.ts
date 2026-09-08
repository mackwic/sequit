import { error } from '@sveltejs/kit';

import type { WorkshopFixture } from '../../app/workshop/runtime/workshop-fixture';
import type { PageLoad } from './$types';

export const load = (async ({
	url,
}: Pick<Parameters<PageLoad>[0], 'url'>): Promise<{ fixture: WorkshopFixture | null }> => {
	if (import.meta.env.DEV) {
		const { loadWorkshopFixture } = await import('../../app/workshop/runtime/workshop-fixture');
		return { fixture: loadWorkshopFixture(url.searchParams) };
	}
	error(404, 'Not found');
}) satisfies PageLoad;
