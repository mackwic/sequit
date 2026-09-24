export enum RegionPresentationIssueCode {
	InvalidRegion = 'invalid-region',
	DuplicateRegion = 'duplicate-region',
	UnknownParent = 'unknown-parent',
	RegionCycle = 'region-cycle',
	UnknownEndpoint = 'unknown-endpoint',
	UnknownAssignedRegion = 'unknown-assigned-region',
	InheritedAssignment = 'inherited-assignment',
	InvalidGroupParent = 'invalid-group-parent',
	NonLeafLanePresentation = 'non-leaf-lane-presentation',
	InvalidLaneOrientation = 'invalid-lane-orientation',
	InvalidLaneGrowth = 'invalid-lane-growth',
	InvalidLaneCount = 'invalid-lane-count',
	InvalidLanePresentation = 'invalid-lane-presentation',
	InvalidLane = 'invalid-lane',
	DuplicateLane = 'duplicate-lane',
	MissingLaneAssignment = 'missing-lane-assignment',
	UnknownLaneAssignment = 'unknown-lane-assignment',
	InheritedLaneAssignment = 'inherited-lane-assignment',
	UnconfiguredLaneAssignment = 'unconfigured-lane-assignment',
}

export interface RegionPresentationIssue {
	readonly code: RegionPresentationIssueCode;
	readonly id: string;
	readonly laneId?: string;
	readonly field?: string;
}
