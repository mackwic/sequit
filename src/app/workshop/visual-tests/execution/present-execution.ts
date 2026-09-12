import {
	type AssertionTargets,
	VisualAssertionError,
} from '../../../../../tests/support/assertions/assertion-error';
import { type ExecutionState, ExecutionStatus } from './scenario-execution';

const verdicts = {
	[ExecutionStatus.Idle]: 'Pas encore exécuté',
	[ExecutionStatus.Running]: 'Exécution…',
	[ExecutionStatus.Passed]: 'Réussi · toutes les assertions passent',
	[ExecutionStatus.Failed]: 'Échec du scénario',
};

export function presentExecution(state: ExecutionState): {
	verdict: string;
	failure: { error: unknown } | null;
	targets: AssertionTargets;
} {
	const verdict = verdicts[state.status];
	if (state.status !== ExecutionStatus.Failed) return { verdict, failure: null, targets: {} };
	let targets: AssertionTargets = {};
	if (state.diagnostic instanceof VisualAssertionError) targets = state.diagnostic.targets;
	return { verdict, failure: { error: state.diagnostic }, targets };
}
