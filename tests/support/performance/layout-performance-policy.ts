const LAYOUT_PERFORMANCE_BENCHMARK_WARMUP_MS = 250;
const LAYOUT_PERFORMANCE_BENCHMARK_SAMPLE_MS = 1000;
export const LAYOUT_PERFORMANCE_GATE_WARMUP_RUNS = 3;
export const LAYOUT_PERFORMANCE_GATE_SAMPLE_RUNS = 11;
/**
 * Temporary headroom on every calibrated snapshot and incremental budget, by explicit user
 * decision while group-layout features land. The calibrated tables stay unchanged; set this back
 * to 1 once the profiling and optimization work has restored the original ceilings.
 */
export const LAYOUT_PERFORMANCE_BUDGET_HEADROOM = 2;

export const LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS = Object.freeze({
	warmupTime: LAYOUT_PERFORMANCE_BENCHMARK_WARMUP_MS,
	time: LAYOUT_PERFORMANCE_BENCHMARK_SAMPLE_MS,
});

export const INCREMENTAL_LAYOUT_RESPONSIVENESS_TARGETS_MS = Object.freeze({
	synchronousProjection: 16,
	total: 50,
});
