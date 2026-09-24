/** The visible projection is valid, but this source-owned folded case has no proved layout. */
export class UnresolvedFoldedGroupLayoutError extends Error {
	constructor(readonly reason: string) {
		super(`Folded group layout is unresolved: ${reason}`);
		this.name = 'UnresolvedFoldedGroupLayoutError';
	}
}
