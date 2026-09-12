import type { LayoutBias, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { VisualLayout } from '../../support/harnesses/visual-layout';

/** Pure scenario contract: consumed directly by tests, observed separately by the optional UI. */
export interface LayoutScenario {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** Optional, independently executable cases belonging to one gallery page. */
	readonly variants?: readonly LayoutScenario[];
	readonly group: string;
	readonly order: number;
	arrange(direction?: LayoutDirection, bias?: LayoutBias): Promise<VisualLayout>;
	assert(layout: VisualLayout): void;
}
