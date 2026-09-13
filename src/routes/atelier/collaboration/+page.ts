import { error } from '@sveltejs/kit';

import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	if (!import.meta.env.DEV) error(404, 'Not found');
	return {
		room: url.searchParams.get('room') ?? 'collaboration-test',
		name: url.searchParams.get('name') ?? 'Alice',
	};
};
