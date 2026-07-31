export function squareShellRank(nodeIndex: number): number {
	return Math.floor(Math.sqrt(nodeIndex));
}

export function squareShellStart(rank: number): number {
	return rank * rank;
}

export function squareShellWidth(rank: number): number {
	return rank * 2 + 1;
}
