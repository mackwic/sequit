import type { LayoutBias, LayoutDirection } from '../../../lib/core/document/logic-document';
import type { VisualLayout } from './visual-layout';

/** Pure scenario contract: consumed directly by tests, observed separately by the optional UI. */
export interface LayoutScenario {
	readonly id: string;
	readonly label: string;
	readonly group: string;
	readonly order: number;
	arrange(direction?: LayoutDirection, bias?: LayoutBias): Promise<VisualLayout>;
	assert(layout: VisualLayout): void;
	readonly simulation?: {
		readonly label: string;
		apply(layout: VisualLayout): VisualLayout;
	};
}
