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
	readonly diagnostic?: unknown;
}

export const initialExecutionState: ExecutionState = {
	status: ExecutionStatus.Idle,
	layout: null,
};

/** Framework-independent execution. Only the latest request may publish a result. */
export class ScenarioExecution {
	private revision = 0;

	constructor(private readonly publish: (state: ExecutionState) => void) {}

	async run(
		scenario: LayoutScenario,
		{ direction, bias }: { readonly direction: LayoutDirection; readonly bias: LayoutBias },
	): Promise<void> {
		const revision = ++this.revision;
		this.publish({ status: ExecutionStatus.Running, layout: null });
		try {
			const layout = await scenario.arrange(direction, bias);
			if (revision !== this.revision) return;
			this.check(scenario, layout);
		} catch (error) {
			if (revision !== this.revision) return;
			this.publish({
				status: ExecutionStatus.Failed,
				layout: null,
				diagnostic: error,
			});
		}
	}

	/** Invalidate pending work when the view is replaced or destroyed. */
	cancel(): void {
		this.revision += 1;
	}

	private check(scenario: LayoutScenario, layout: VisualLayout): void {
		try {
			scenario.assert(layout);
			this.publish({ status: ExecutionStatus.Passed, layout });
		} catch (error) {
			this.publish({
				status: ExecutionStatus.Failed,
				layout,
				diagnostic: error,
			});
		}
	}
}
