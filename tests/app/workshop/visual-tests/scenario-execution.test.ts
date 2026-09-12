import { describe, expect, it, vi } from 'vitest';

import { defaultVisualTestSettings } from '../../../../src/app/workshop/visual-tests/directions';
import {
	type ExecutionState,
	ExecutionStatus,
	ScenarioExecution,
} from '../../../../src/app/workshop/visual-tests/execution/scenario-execution';
import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { scenario as centeredChain } from '../../../scenarios/visual/nodes/centered-chain.scenario';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

const settings = defaultVisualTestSettings;
const empty = new VisualLayout({ width: 100, height: 100, elements: [], relations: [] });

it('publishes running then the checked result and forwards the layout configuration', async () => {
	const publish = vi.fn<(state: ExecutionState) => void>();
	const execution = new ScenarioExecution(publish);
	const scenario = { ...centeredChain, arrange: vi.fn().mockResolvedValue(empty), assert: vi.fn() };
	const configuration = { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Right };
	await execution.run(scenario, configuration);
	expect(scenario.arrange).toHaveBeenCalledWith(configuration.direction, configuration.bias);
	expect(scenario.assert).toHaveBeenCalledWith(empty);
	expect(publish.mock.calls.map(([state]) => state)).toEqual([
		{ status: ExecutionStatus.Running, layout: null },
		{ status: ExecutionStatus.Passed, layout: empty },
	]);
});

it('preserves the original assertion error and drawing for the verdict UI', async () => {
	const publish = vi.fn<(state: ExecutionState) => void>();
	const execution = new ScenarioExecution(publish);
	const error = new Error('Expected another rank');
	await execution.run(
		{
			...centeredChain,
			arrange: () => Promise.resolve(empty),
			assert() {
				throw error;
			},
		},
		settings,
	);
	expect(publish).toHaveBeenLastCalledWith({
		status: ExecutionStatus.Failed,
		layout: empty,
		diagnostic: error,
	});
	expect(publish.mock.lastCall?.[0].diagnostic).toBe(error);
});

it('reports preparation errors without leaving a previous drawing visible', async () => {
	const publish = vi.fn<(state: ExecutionState) => void>();
	const execution = new ScenarioExecution(publish);
	await execution.run(centeredChain, settings);
	await execution.run(
		{
			...centeredChain,
			arrange() {
				throw new Error('Cannot build');
			},
		},
		settings,
	);
	expect(publish).toHaveBeenLastCalledWith({
		status: ExecutionStatus.Failed,
		layout: null,
		diagnostic: new Error('Cannot build'),
	});
});

describe.each(['resolve', 'reject'] as const)('superseded preparation: %s', (outcome) => {
	it('keeps the latest result even when an earlier request finishes afterward', async () => {
		const publish = vi.fn<(state: ExecutionState) => void>();
		const execution = new ScenarioExecution(publish);
		const pending = Promise.withResolvers<VisualLayout>();
		const stale = { ...centeredChain, arrange: () => pending.promise, assert: vi.fn() };
		const first = execution.run(stale, settings);
		await execution.run(centeredChain, settings);
		const calls = publish.mock.calls.length;
		if (outcome === 'resolve') pending.resolve(empty);
		else pending.reject(new Error('Obsolete failure'));
		await first;
		expect(stale.assert).not.toHaveBeenCalled();
		expect(publish).toHaveBeenCalledTimes(calls);
	});
	it('does not publish after the view has been destroyed', async () => {
		const publish = vi.fn<(state: ExecutionState) => void>();
		const execution = new ScenarioExecution(publish);
		const pending = Promise.withResolvers<VisualLayout>();
		const run = execution.run({ ...centeredChain, arrange: () => pending.promise }, settings);
		execution.cancel();
		if (outcome === 'resolve') pending.resolve(empty);
		else pending.reject(new Error('Cancelled failure'));
		await run;
		expect(publish).toHaveBeenCalledTimes(1);
	});
});
