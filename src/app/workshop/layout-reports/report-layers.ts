/** What the report canvas draws over each other; the page switches them. */
export interface ReportLayers {
	/** The geometry the reporter's layout computed. */
	layout: boolean;
	/** What the reporter's page drew, read back from its DOM. */
	rendered: boolean;
	/** The part of the canvas the reporter's viewport showed. */
	visible: boolean;
	/** The geometry the reporter's page showed before its last change. */
	previous: boolean;
	/** The geometry the current engine computes for the same document and measurements. */
	replayed: boolean;
	zones: boolean;
}
