/** Ordered, non-empty palette; callers can supply another palette without changing routing. */
export type RoutePalette = readonly [string, ...string[]];

export const DEFAULT_ROUTE_PALETTE: RoutePalette = [
	'var(--content-relation-1)',
	'var(--content-relation-2)',
	'var(--content-relation-3)',
	'var(--content-relation-4)',
	'var(--content-relation-5)',
	'var(--content-relation-6)',
	'var(--content-relation-7)',
];
