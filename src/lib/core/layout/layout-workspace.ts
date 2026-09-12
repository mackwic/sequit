import type { LayoutFrame } from './geometry/layout-frame';
import type { PlacementState } from './placement/place-elements';
import type { PreparedMeasurements } from './placement/prepare-measurements';
import type { NodeRouting } from './routing/reserve-node-routing';
import type { LayoutStructure } from './structure/prepare-layout';

/** One call owns this workspace. Only orchestration sees all phases; no state survives a call. */
export interface LayoutWorkspace {
	readonly structure: LayoutStructure;
	readonly frame: LayoutFrame;
	readonly measurements: PreparedMeasurements;
	readonly placement: PlacementState;
	routing: NodeRouting | undefined;
}
