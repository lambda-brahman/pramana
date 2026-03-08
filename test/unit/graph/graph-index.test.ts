import { test, expect, describe } from "bun:test";
import { GraphIndex } from "../../../src/graph/index.ts";
import type { KnowledgeArtifact } from "../../../src/schema/index.ts";

function makeArtifact(overrides: Partial<KnowledgeArtifact> = {}): KnowledgeArtifact {
	return {
		slug: "test",
		title: "Test",
		tags: ["entity"],
		relationships: [],
		sections: [],
		content: "# Test\n\nContent.",
		hash: "abc123",
		...overrides,
	};
}

function buildFixtureGraph(): GraphIndex {
	// Recreates the test/fixtures graph:
	// order → depends-on → customer, line-item, shipping-info
	// customer → relates-to → order
	// line-item → depends-on → order
	// shipping-info → depends-on → order
	return GraphIndex.fromArtifacts([
		makeArtifact({
			slug: "order",
			title: "Order",
			tags: ["entity", "commerce", "core"],
			relationships: [
				{ target: "customer", type: "depends-on" },
				{ target: "line-item", type: "depends-on" },
				{ target: "shipping-info", type: "depends-on" },
			],
		}),
		makeArtifact({
			slug: "customer",
			title: "Customer",
			tags: ["entity", "commerce", "core"],
			relationships: [{ target: "order", type: "relates-to" }],
		}),
		makeArtifact({
			slug: "line-item",
			title: "Line Item",
			tags: ["entity", "commerce"],
			relationships: [{ target: "order", type: "depends-on" }],
		}),
		makeArtifact({
			slug: "shipping-info",
			title: "Shipping Info",
			tags: ["value-object", "commerce"],
			relationships: [{ target: "order", type: "depends-on" }],
		}),
	]);
}

describe("GraphIndex", () => {
	describe("fromArtifacts", () => {
		test("creates graph with correct node count", () => {
			const graph = buildFixtureGraph();
			expect(graph.nodeCount()).toBe(4);
		});

		test("creates graph with correct edge count", () => {
			const graph = buildFixtureGraph();
			// order→customer, order→line-item, order→shipping-info,
			// customer→order, line-item→order, shipping-info→order
			expect(graph.edgeCount()).toBe(6);
		});

		test("skips edges to nonexistent nodes", () => {
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({
					slug: "a",
					relationships: [{ target: "nonexistent", type: "depends-on" }],
				}),
			]);
			expect(graph.nodeCount()).toBe(1);
			expect(graph.edgeCount()).toBe(0);
		});

		test("strips section from target slug", () => {
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({
					slug: "a",
					relationships: [{ target: "b#pricing", type: "depends-on" }],
				}),
				makeArtifact({ slug: "b" }),
			]);
			expect(graph.edgeCount()).toBe(1);
		});

		test("handles empty artifact list", () => {
			const graph = GraphIndex.fromArtifacts([]);
			expect(graph.nodeCount()).toBe(0);
			expect(graph.edgeCount()).toBe(0);
		});
	});

	describe("metrics", () => {
		test("returns correct metrics for fixture graph", () => {
			const graph = buildFixtureGraph();
			const metrics = graph.metrics();
			expect(metrics.nodeCount).toBe(4);
			expect(metrics.edgeCount).toBe(6);
			expect(metrics.density).toBeCloseTo(6 / (4 * 3), 5);
		});

		test("returns zero density for single node", () => {
			const graph = GraphIndex.fromArtifacts([makeArtifact({ slug: "solo" })]);
			expect(graph.metrics().density).toBe(0);
		});
	});

	describe("degreeCentrality", () => {
		test("order has highest degree centrality", () => {
			const graph = buildFixtureGraph();
			const centrality = graph.degreeCentrality();
			expect(centrality.length).toBe(4);
			// Order connects to all 3 others and receives from all 3 → highest
			expect(centrality[0]!.slug).toBe("order");
			expect(centrality[0]!.score).toBeGreaterThan(0);
		});

		test("all nodes have positive degree", () => {
			const graph = buildFixtureGraph();
			const centrality = graph.degreeCentrality();
			for (const entry of centrality) {
				expect(entry.score).toBeGreaterThan(0);
			}
		});
	});

	describe("betweennessCentrality", () => {
		test("returns scores for all nodes", () => {
			const graph = buildFixtureGraph();
			const centrality = graph.betweennessCentrality();
			expect(centrality.length).toBe(4);
		});

		test("hub node has highest betweenness in chain", () => {
			// a → b → c → d (b and c are between endpoints)
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({
					slug: "a",
					relationships: [{ target: "b", type: "relates-to" }],
				}),
				makeArtifact({
					slug: "b",
					relationships: [{ target: "c", type: "relates-to" }],
				}),
				makeArtifact({
					slug: "c",
					relationships: [{ target: "d", type: "relates-to" }],
				}),
				makeArtifact({ slug: "d" }),
			]);
			const centrality = graph.betweennessCentrality();
			const bScore = centrality.find((c) => c.slug === "b")!.score;
			const aScore = centrality.find((c) => c.slug === "a")!.score;
			expect(bScore).toBeGreaterThanOrEqual(aScore);
		});
	});

	describe("communities", () => {
		test("detects communities in fixture graph", () => {
			const graph = buildFixtureGraph();
			const result = graph.communities();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			// All nodes are tightly connected — may be 1 or 2 communities
			expect(result.value.length).toBeGreaterThanOrEqual(1);
		});

		test("returns empty for empty graph", () => {
			const graph = GraphIndex.fromArtifacts([]);
			const result = graph.communities();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(0);
		});

		test("detects separate communities in disconnected graph", () => {
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({
					slug: "a",
					relationships: [{ target: "b", type: "relates-to" }],
				}),
				makeArtifact({
					slug: "b",
					relationships: [{ target: "a", type: "relates-to" }],
				}),
				makeArtifact({
					slug: "c",
					relationships: [{ target: "d", type: "relates-to" }],
				}),
				makeArtifact({
					slug: "d",
					relationships: [{ target: "c", type: "relates-to" }],
				}),
			]);
			const result = graph.communities();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.length).toBe(2);
		});
	});

	describe("shortestPath", () => {
		test("finds direct path", () => {
			const graph = buildFixtureGraph();
			const result = graph.shortestPath("order", "customer");
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).not.toBeNull();
			expect(result.value!.path).toEqual(["order", "customer"]);
			expect(result.value!.length).toBe(1);
		});

		test("finds indirect path", () => {
			// a → b → c (no direct a→c)
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({
					slug: "a",
					relationships: [{ target: "b", type: "relates-to" }],
				}),
				makeArtifact({
					slug: "b",
					relationships: [{ target: "c", type: "relates-to" }],
				}),
				makeArtifact({ slug: "c" }),
			]);
			const result = graph.shortestPath("a", "c");
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).not.toBeNull();
			expect(result.value!.path).toEqual(["a", "b", "c"]);
			expect(result.value!.length).toBe(2);
		});

		test("returns null for disconnected nodes", () => {
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({ slug: "a" }),
				makeArtifact({ slug: "b" }),
			]);
			const result = graph.shortestPath("a", "b");
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toBeNull();
		});

		test("returns error for missing node", () => {
			const graph = buildFixtureGraph();
			const result = graph.shortestPath("order", "nonexistent");
			expect(result.ok).toBe(false);
		});
	});

	describe("connectedComponents", () => {
		test("single component for connected graph", () => {
			const graph = buildFixtureGraph();
			const components = graph.connectedComponents();
			expect(components).toHaveLength(1);
			expect(components[0]!.members).toHaveLength(4);
		});

		test("multiple components for disconnected graph", () => {
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({ slug: "a" }),
				makeArtifact({ slug: "b" }),
				makeArtifact({
					slug: "c",
					relationships: [{ target: "d", type: "relates-to" }],
				}),
				makeArtifact({ slug: "d" }),
			]);
			const components = graph.connectedComponents();
			expect(components.length).toBe(3); // {c,d}, {a}, {b}
		});

		test("sorted by size descending", () => {
			const graph = GraphIndex.fromArtifacts([
				makeArtifact({
					slug: "a",
					relationships: [{ target: "b", type: "relates-to" }],
				}),
				makeArtifact({ slug: "b" }),
				makeArtifact({ slug: "c" }),
			]);
			const components = graph.connectedComponents();
			expect(components[0]!.members.length).toBeGreaterThanOrEqual(
				components[components.length - 1]!.members.length,
			);
		});
	});

	describe("neighbors", () => {
		test("returns direct neighbors", () => {
			const graph = buildFixtureGraph();
			const result = graph.neighbors("order");
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toContain("customer");
			expect(result.value).toContain("line-item");
			expect(result.value).toContain("shipping-info");
		});

		test("returns error for missing node", () => {
			const graph = buildFixtureGraph();
			const result = graph.neighbors("nonexistent");
			expect(result.ok).toBe(false);
		});
	});

	describe("traverse", () => {
		test("traverses at depth 1", () => {
			const graph = buildFixtureGraph();
			const result = graph.traverse("order", undefined, 1);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toContain("customer");
			expect(result.value).toContain("line-item");
			expect(result.value).toContain("shipping-info");
		});

		test("returns error for missing node", () => {
			const graph = buildFixtureGraph();
			const result = graph.traverse("nonexistent");
			expect(result.ok).toBe(false);
		});
	});
});
