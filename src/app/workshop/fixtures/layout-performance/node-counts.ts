export const LAYOUT_PERFORMANCE_NODE_COUNTS = [10, 19, 50, 100, 1000] as const;

export type LayoutPerformanceNodeCount = (typeof LAYOUT_PERFORMANCE_NODE_COUNTS)[number];
