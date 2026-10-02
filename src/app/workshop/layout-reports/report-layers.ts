/** What the report canvas draws over each other. */
export interface ReportLayers {
	/** The geometry the reporter's layout computed. */
	readonly layout: boolean;
	/** What the reporter's page drew, read back from its DOM. */
	readonly rendered: boolean;
	/** The geometry the current engine computes for the same document and measurements. */
	readonly replayed: boolean;
	readonly zones: boolean;
}
