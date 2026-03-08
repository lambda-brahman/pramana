import { test, expect, describe, beforeEach } from "bun:test";
import { SqlitePlugin } from "../../../src/storage/sqlite/index.ts";
import { GraphIndex } from "../../../src/graph/index.ts";
import { Reader } from "../../../src/engine/reader.ts";
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

describe("Reader with GraphIndex", () => {
	let storage: SqlitePlugin;
	let reader: Reader;

	beforeEach(() => {
		storage = new SqlitePlugin(":memory:");
		storage.initialize();

		const artifacts = [
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
		];

		for (const a of artifacts) {
			storage.store(a);
		}

		const graphIndex = GraphIndex.fromArtifacts(artifacts);
		reader = new Reader(storage, storage, graphIndex);
	});

	test("existing four primitives still work", () => {
		const get = reader.get("order");
		expect(get.ok).toBe(true);

		const search = reader.search("Order");
		expect(search.ok).toBe(true);

		const traverse = reader.traverse("order", "depends-on");
		expect(traverse.ok).toBe(true);

		const list = reader.list();
		expect(list.ok).toBe(true);
	});

	test("graphMetrics returns correct counts", () => {
		const result = reader.graphMetrics();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.nodeCount).toBe(4);
		expect(result.value.edgeCount).toBe(6);
		expect(result.value.density).toBeGreaterThan(0);
	});

	test("degreeCentrality identifies order as hub", () => {
		const result = reader.degreeCentrality();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.length).toBe(4);
		expect(result.value[0]!.slug).toBe("order");
	});

	test("betweennessCentrality returns scores", () => {
		const result = reader.betweennessCentrality();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.length).toBe(4);
	});

	test("communities detects at least one community", () => {
		const result = reader.communities();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.length).toBeGreaterThanOrEqual(1);

		// All nodes assigned to a community
		const allMembers = result.value.flatMap((c) => c.members);
		expect(allMembers).toContain("order");
		expect(allMembers).toContain("customer");
	});

	test("shortestPath finds route between nodes", () => {
		const result = reader.shortestPath("line-item", "customer");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).not.toBeNull();
		expect(result.value!.path[0]).toBe("line-item");
		expect(result.value!.path[result.value!.path.length - 1]).toBe("customer");
	});

	test("connectedComponents returns single component", () => {
		const result = reader.connectedComponents();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toHaveLength(1);
		expect(result.value[0]!.members).toHaveLength(4);
	});
});

describe("Reader without GraphIndex", () => {
	let reader: Reader;

	beforeEach(() => {
		const storage = new SqlitePlugin(":memory:");
		storage.initialize();
		reader = new Reader(storage, storage);
	});

	test("graph methods return error when no graph index", () => {
		const metrics = reader.graphMetrics();
		expect(metrics.ok).toBe(false);

		const centrality = reader.degreeCentrality();
		expect(centrality.ok).toBe(false);

		const communities = reader.communities();
		expect(communities.ok).toBe(false);

		const shortestPath = reader.shortestPath("a", "b");
		expect(shortestPath.ok).toBe(false);

		const components = reader.connectedComponents();
		expect(components.ok).toBe(false);
	});
});
