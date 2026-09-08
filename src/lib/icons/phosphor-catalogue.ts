import { icons } from '@phosphor-icons/core';

export interface PhosphorIconChoice {
	readonly id: string;
	readonly label: string;
	readonly search: string;
}

/** Use the provider's search tags and categories, as well as its stable icon names. */
export const phosphorIcons: readonly PhosphorIconChoice[] = icons.map(
	({ name, tags, categories }) => ({
		id: `phosphor:${name}`,
		label: name.replaceAll('-', ' '),
		search: [name, ...tags, ...categories].join(' ').replaceAll('-', ' ').toLowerCase(),
	}),
);
