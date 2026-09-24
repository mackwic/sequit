/** Stable failure identities for composition and leaf incident validation. */
export enum RegionGeometryDiagnosticCode {
	WrongRootRegion = 'wrong-root-region',
	InvalidRootBounds = 'invalid-root-bounds',
	ChildRegionInventory = 'child-region-inventory',
	RepeatedChildRegion = 'repeated-child-region',
	UnknownChildRegion = 'unknown-child-region',
	MissingChildRegion = 'missing-child-region',
	WrongChildParent = 'wrong-child-parent',
	ChildOutsideParent = 'child-outside-parent',
	OverlappingChildren = 'overlapping-children',
	MissingLeafLayout = 'missing-leaf-layout',
	LeafElementInventory = 'leaf-element-inventory',
	TranslatedElementMismatch = 'translated-element-mismatch',
	ElementOutsideLeaf = 'element-outside-leaf',
	LeafRelationInventory = 'leaf-relation-inventory',
	TranslatedRelationMismatch = 'translated-relation-mismatch',
	MemberOutsideGroup = 'member-outside-group',
	LaneIdentityMismatch = 'lane-identity-mismatch',
	LaneOutsideLeaf = 'lane-outside-leaf',
	TranslatedLaneMismatch = 'translated-lane-mismatch',
	LeafLaneInventory = 'leaf-lane-inventory',
	GlobalLaneInventory = 'global-lane-inventory',
	ElementInventory = 'element-inventory',
	UnknownElement = 'unknown-element',
	NonOrthogonalOwnedPiece = 'non-orthogonal-owned-piece',
	UnknownRouteOwner = 'unknown-route-owner',
	OwnedPieceOutsideRegion = 'owned-piece-outside-region',
	OwnedPieceEntersOpaqueChild = 'owned-piece-enters-opaque-child',
	OwnedPieceInventory = 'owned-piece-inventory',
	WrongBoundaryOwner = 'wrong-boundary-owner',
	PortalInventory = 'portal-inventory',
	InvalidBoundaryPortal = 'invalid-boundary-portal',
	DisconnectedBoundaryPortal = 'disconnected-boundary-portal',
	InvalidComposedRoute = 'invalid-composed-route',
	OwnedPiecesMismatch = 'owned-pieces-mismatch',
	RelationInventory = 'relation-inventory',
	UnknownRelation = 'unknown-relation',
	UnknownOwnedRouteRelation = 'unknown-owned-route-relation',
	UnknownPortalRelation = 'unknown-portal-relation',
	ParentRouteContact = 'parent-route-contact',
	IncidentPortalInventory = 'incident-portal-inventory',
	IncidentPieceInventory = 'incident-piece-inventory',
	NonOrthogonalIncident = 'non-orthogonal-incident',
	MissingIncidentNode = 'missing-incident-node',
	IncidentWrongAttachment = 'incident-wrong-attachment',
	IncidentCrossesForeignNode = 'incident-crosses-foreign-node',
	LocalRelationMissing = 'local-relation-missing',
	LocalRelationNonOrthogonal = 'local-relation-non-orthogonal',
	IncidentTouchesLocalRelation = 'incident-touches-local-relation',
}

export enum RegionIncidentRole {
	Source = 'source',
	Target = 'target',
}

export interface RegionGeometryProvenance {
	readonly relationId?: string;
	readonly regionId?: string;
	readonly endpointId?: string;
	readonly relatedEndpointId?: string;
	readonly laneId?: string;
	readonly relatedRelationId?: string;
	readonly relatedRegionId?: string;
	readonly role?: RegionIncidentRole;
}

export interface RegionGeometryDiagnostic extends RegionGeometryProvenance {
	readonly code: RegionGeometryDiagnosticCode;
	readonly message: string;
}

export function regionGeometryDiagnostic(
	code: RegionGeometryDiagnosticCode,
	message: string,
	provenance: RegionGeometryProvenance = {},
): RegionGeometryDiagnostic {
	return { code, message, ...provenance };
}
