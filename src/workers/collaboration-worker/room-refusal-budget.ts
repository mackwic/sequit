const MAX_PROPOSAL_REFUSALS = 6;
const MAX_SOCKET_REFUSALS = 24;
const ROOM_REFUSAL_TOKENS = 64;
const TOKEN_REFILL_MS = 1_000;

interface SocketBudget {
	readonly proposals: Map<string, number>;
	total: number;
}

/** Socket identity cannot be forged by a client; the room bucket bounds reconnect churn. */
export class RoomRefusalBudget {
	readonly #sockets = new WeakMap<WebSocket, SocketBudget>();
	#tokens = ROOM_REFUSAL_TOKENS;
	#lastRefill = Date.now();

	allow(socket: WebSocket, proposalId: string): boolean {
		const now = Date.now();
		const elapsed = Math.max(0, now - this.#lastRefill);
		this.#tokens = Math.min(ROOM_REFUSAL_TOKENS, this.#tokens + elapsed / TOKEN_REFILL_MS);
		this.#lastRefill = now;
		let budget = this.#sockets.get(socket);
		if (budget === undefined) {
			budget = { proposals: new Map(), total: 0 };
			this.#sockets.set(socket, budget);
		}
		const count = budget.proposals.get(proposalId) ?? 0;
		const exhausted = budget.total >= MAX_SOCKET_REFUSALS || count >= MAX_PROPOSAL_REFUSALS;
		if (this.#tokens < 1 || exhausted) return false;
		this.#tokens--;
		budget.total++;
		budget.proposals.set(proposalId, count + 1);
		return true;
	}
}
