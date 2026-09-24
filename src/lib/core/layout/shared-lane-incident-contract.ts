/** A source port reserved at the centre of a parallel lane leaf's right face. */
export interface SharedLaneOutgoingIncident {
	readonly relationId: string;
	readonly endpointId: string;
	readonly side: 1;
}
