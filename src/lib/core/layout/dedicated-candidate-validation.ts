import { EndpointKind } from '../document/logic-document';
import { routeBridgeAnalysis } from './bridge-oracle';
import {
	elementsById,
	validateGroupContainment,
	validateRelationInventory,
} from './dedicated-candidate-validation/element-checks';
import {
	validateElementBounds,
	validateElementOverlap,
	validateRankRows,
} from './dedicated-candidate-validation/layout-checks';
import { validatePorts } from './dedicated-candidate-validation/ports';
import { contactFailure } from './dedicated-candidate-validation/route-contacts';
import { routeFailure } from './dedicated-candidate-validation/route-geometry';
import { routeScore } from './dedicated-candidate-validation/route-score';
import type {
	DedicatedCandidateValidation,
	DedicatedCandidateValidationInput,
} from './dedicated-candidate-validation/types';
import { prepareRouteObstacles } from './routing/route-obstacles';

export {
	compareDedicatedRouteScores,
	scoreDedicatedCandidateRoutes,
} from './dedicated-candidate-validation/route-score';
export type {
	DedicatedCandidateValidation,
	DedicatedCandidateValidationInput,
	RejectedDedicatedCandidate,
	ValidDedicatedCandidate,
} from './dedicated-candidate-validation/types';
export { DedicatedCandidateRejectionCode } from './dedicated-candidate-validation/types';

/** Independent geometry oracle for candidates produced by the dedicated engine. */
export function validateDedicatedCandidate(
	input: DedicatedCandidateValidationInput,
): DedicatedCandidateValidation {
	const elements = elementsById(input);
	if ('valid' in elements) return elements;
	const relationFailure = validateRelationInventory(input);
	if (relationFailure !== undefined) return relationFailure;
	const boundsFailure = validateElementBounds(input, elements);
	if (boundsFailure !== undefined) return boundsFailure;
	const groupFailure = validateGroupContainment(input, elements);
	if (groupFailure !== undefined) return groupFailure;
	const rankFailure = validateRankRows(input, elements);
	if (rankFailure !== undefined) return rankFailure;
	const overlapFailure = validateElementOverlap(input, elements);
	if (overlapFailure !== undefined) return overlapFailure;
	const groups = [...elements.values()].filter(({ kind }) => kind === EndpointKind.Group);
	const nodeBoxes = [...elements.values()]
		.filter(({ kind }) => kind !== EndpointKind.Group)
		.map(({ bounds }) => bounds);
	const obstacles = { nodes: prepareRouteObstacles(nodeBoxes, 0), groups };
	for (const route of input.layout.relations) {
		const failure = routeFailure(input, route, elements, obstacles);
		if (failure !== undefined) return failure;
	}
	const portFailure = validatePorts(input, elements);
	if (portFailure !== undefined) return portFailure;
	const analysis = routeBridgeAnalysis(input.layout.relations);
	const contactRejection = contactFailure(input.layout, analysis);
	if (contactRejection !== undefined) return contactRejection;
	return { valid: true, score: routeScore(input.layout, analysis) };
}
