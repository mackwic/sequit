import { error } from '@sveltejs/kit';

export function load(): Record<string, never> {
	if (!import.meta.env.DEV) error(404, 'Not found');
	return {};
}
