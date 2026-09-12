import type { LayoutBias, LayoutDirection } from '../../../../lib/core/document/logic-document';
import type { LayoutScenario } from '../scenario';
import type { VisualLayout } from '../visual-layout';

export enum ExecutionStatus {
	Idle = 'idle',
	Running = 'running',
	Passed = 'passed',
	Failed = 'failed',
}

export interface ExecutionState {
	readonly status: ExecutionStatus;
	readonly layout: VisualLayout | null;
	readonly simulated: boolean;
	readonly diagnostic?: unknown;
}

export const initialExecutionState: ExecutionState = {
	status: ExecutionStatus.Idle,
	layout: null,
	simulated: false,
};

/** Framework-independent execution. Only the latest request may publish a result. */
export class ScenarioExecution {
	private revision = 0;
	private state = initialExecutionState;
	private scenario: LayoutScenario | undefined;

	constructor(private readonly publish: (state: ExecutionState) => void) {}

	async run(
		scenario: LayoutScenario,
		{ direction, bias }: { readonly direction: LayoutDirection; readonly bias: LayoutBias },
	): Promise<void> {
		const revision = ++this.revision;
		this.scenario = scenario;
		this.update({ status: ExecutionStatus.Running, layout: null, simulated: false });
		try {
			const layout = await scenario.arrange(direction, bias);
			if (revision !== this.revision) return;
			this.check(scenario, layout, false);
		} catch (error) {
			if (revision !== this.revision) return;
			this.update({
				status: ExecutionStatus.Failed,
				layout: null,
				simulated: false,
				diagnostic: error,
			});
		}
	}

	/** Invalidate pending work when the view is replaced or destroyed. */
	cancel(): void {
		this.revision += 1;
	}

	simulate(): void {
		const { layout, simulated } = this.state;
		const scenario = this.scenario;
		if (layout === null || simulated || scenario?.simulation === undefined) return;
		try {
			this.check(scenario, scenario.simulation.apply(layout), true);
		} catch (error) {
			this.update({
				...this.state,
				status: ExecutionStatus.Failed,
				diagnostic: error,
			});
		}
	}

	private check(scenario: LayoutScenario, layout: VisualLayout, simulated: boolean): void {
		try {
			scenario.assert(layout);
			this.update({ status: ExecutionStatus.Passed, layout, simulated });
		} catch (error) {
			this.update({
				status: ExecutionStatus.Failed,
				layout,
				simulated,
				diagnostic: error,
			});
		}
	}

	private update(state: ExecutionState): void {
		this.state = state;
		this.publish(state);
	}
}
