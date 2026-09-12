import { describe, expect, it } from 'vitest';

import { VisualAssertionError } from '../../../../src/app/workshop/visual-tests/assertion-error';
import { presentExecution } from '../../../../src/app/workshop/visual-tests/execution/present-execution';
import {
	ExecutionStatus,
	initialExecutionState,
} from '../../../../src/app/workshop/visual-tests/execution/scenario-execution';

describe('execution presentation', () => {
	it.each([ExecutionStatus.Idle, ExecutionStatus.Running, ExecutionStatus.Passed])(
		'does not expose stale errors for %s',
		(status) => {
			const result = presentExecution({
				...initialExecutionState,
				status,
				diagnostic: new Error('old'),
			});
			expect(result.failure).toBeNull();
			expect(result.targets).toEqual({});
			expect(result.verdict).not.toContain('Échec');
		},
	);
	it('preserves structured diagnostics and their exact targets', () => {
		const error = new VisualAssertionError('Route', 'straight', 'bent', { routes: ['a-b'] });
		const result = presentExecution({
			...initialExecutionState,
			status: ExecutionStatus.Failed,
			diagnostic: error,
		});
		expect(result.failure?.error).toBe(error);
		expect(result.targets).toEqual({ routes: ['a-b'] });
		expect(result.verdict).toBe('Échec du scénario');
	});
	it.each([new Error('Unexpected'), undefined, 'failure'])(
		'retains an arbitrary thrown value without inventing targets',
		(diagnostic) => {
			const result = presentExecution({
				...initialExecutionState,
				status: ExecutionStatus.Failed,
				diagnostic,
			});
			expect(result.failure).toEqual({ error: diagnostic });
			expect(result.targets).toEqual({});
		},
	);
});
