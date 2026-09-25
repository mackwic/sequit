import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  compareRankOrderCorpus,
  rankOrderComparisonCorpus,
} from "../../../../src/app/workshop/solver-prototype/rank-order-comparison";
import { countRankOrderCrossings } from "../../../../src/lib/core/layout/rank-order";

describe("rank order comparison", () => {
  const comparison = compareRankOrderCorpus(rankOrderComparisonCorpus());

  it("validates both orders and never worsens crossings by enumerating", () => {
    expect(comparison.entries.map(({ id }) => id)).toEqual([
      "adjacent-3+1",
      "adjacent-2+2",
      "two-successors",
      "two-predecessors",
      "three-predecessors",
    ]);
    for (const entry of comparison.entries) {
      expect(entry.documentaryValid).toBe(true);
      expect(entry.enumeratedValid).toBe(true);
      expect(entry.enumeratedCount).toBeGreaterThan(0);
      expect(entry.enumeratedCrossings).toBeLessThanOrEqual(
        entry.documentaryCrossings,
      );
    }
  });

  it("reports the 3+1 documentary target order as a crossing divergence", () => {
    const entry = comparison.entries.find(({ id }) => id === "adjacent-3+1");
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.divergence).toBe(true);
    expect(entry.documentaryCrossings).toBe(2);
    expect(entry.enumeratedCrossings).toBe(0);
    expect(entry.documentary[0]).toEqual(["d", "e"]);
    expect(entry.documentary[1]).toEqual(["a", "b", "c"]);
    expect(entry.enumerated).not.toEqual(entry.documentary);
    expect(entry.enumeratedCount).toBe(12);
    // The known witness: inverting the target band strictly lowers the crossing count.
    expect(
      countRankOrderCrossings(
        [
          ["e", "d"],
          ["a", "b", "c"],
        ],
        entry.relations,
      ),
    ).toBeLessThan(countRankOrderCrossings(entry.documentary, entry.relations));
  });

  it("matches pinned dedicated-engine layout fingerprints for every corpus entry", () => {
    const expected: Record<string, string> = {
      "adjacent-3+1":
        "3f17c7521dca3ad3c89131161233c1d3a5514df3ca9bbad6ae9eb22386dd60b8",
      "adjacent-2+2":
        "12ccca819414a81c3f82bb216d4cdd62246dbcc8d909ec7f3b288e9c3f0cc4f1",
      "two-successors":
        "cbef67223f47ce6a3ae02f7b451be2d111218576501be214a3cba1a06160a157",
      "two-predecessors":
        "72956e705ceb18d863ee61533d5c77604512850401a8fe71614ddf6922dacb01",
      "three-predecessors":
        "b317d5a37873c18ff1bdfc1feb79efbfbc886a53e8b520ae2a1b7b4a8307a864",
    };
    for (const entry of comparison.entries) {
      expect(
        createHash("sha256").update(JSON.stringify(entry.layout)).digest("hex"),
      ).toBe(expected[entry.id]);
    }
  });
});
