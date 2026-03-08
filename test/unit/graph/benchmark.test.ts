import { test, expect, describe } from "bun:test";
import { GraphIndex } from "../../../src/graph/index.ts";
import { SqlitePlugin } from "../../../src/storage/sqlite/index.ts";
import { Reader } from "../../../src/engine/reader.ts";
import type { KnowledgeArtifact } from "../../../src/schema/index.ts";

function makeArtifact(slug: string, targets: string[]): KnowledgeArtifact {
	return {
		slug,
		title: slug,
		tags: ["entity"],
		relationships: targets.map((t) => ({ target: t, type: "depends-on" as const })),
		sections: [],
		content: `# ${slug}\n\nContent for ${slug}.`,
		hash: `hash-${slug}`,
	};
}

function generateGraph(nodeCount: number): KnowledgeArtifact[] {
	const artifacts: KnowledgeArtifact[] = [];
	for (let i = 0; i < nodeCount; i++) {
		const targets: string[] = [];
		// Each node connects to 2-4 random subsequent nodes
		const edgeCount = Math.min(2 + (i % 3), nodeCount - i - 1);
		for (let j = 0; j < edgeCount; j++) {
			const targetIdx = (i + j + 1) % nodeCount;
			targets.push(`node-${targetIdx}`);
		}
		artifacts.push(makeArtifact(`node-${i}`, targets));
	}
	return artifacts;
}

describe("Benchmark: GraphIndex vs SQLite", () => {
	const SIZES = [100, 500, 1000];

	for (const size of SIZES) {
		describe(`${size} nodes`, () => {
			const artifacts = generateGraph(size);

			test(`graph index build time (${size} nodes)`, () => {
				const start = performance.now();
				const graph = GraphIndex.fromArtifacts(artifacts);
				const elapsed = performance.now() - start;

				console.log(`  GraphIndex build (${size} nodes): ${elapsed.toFixed(2)}ms`);
				expect(graph.nodeCount()).toBe(size);

				// Success criteria: < 50ms for 1000 artifacts
				if (size <= 1000) {
					expect(elapsed).toBeLessThan(50);
				}
			});

			test(`SQLite BFS traverse vs graph traverse (${size} nodes)`, () => {
				// SQLite setup
				const storage = new SqlitePlugin(":memory:");
				storage.initialize();
				for (const a of artifacts) {
					storage.store(a);
				}
				const reader = new Reader(storage, storage);

				// GraphIndex setup
				const graph = GraphIndex.fromArtifacts(artifacts);

				const depths = [1, 2, 3];
				for (const depth of depths) {
					// SQLite BFS
					const sqlStart = performance.now();
					const sqlResult = reader.traverse("node-0", undefined, depth);
					const sqlElapsed = performance.now() - sqlStart;

					// GraphIndex BFS
					const graphStart = performance.now();
					const graphResult = graph.traverse("node-0", undefined, depth);
					const graphElapsed = performance.now() - graphStart;

					const sqlCount = sqlResult.ok ? sqlResult.value.length : 0;
					const graphCount = graphResult.ok ? graphResult.value.length : 0;

					console.log(
						`  Traverse depth=${depth}: SQLite=${sqlElapsed.toFixed(2)}ms (${sqlCount} nodes), ` +
							`Graph=${graphElapsed.toFixed(2)}ms (${graphCount} nodes)`,
					);

					expect(sqlResult.ok).toBe(true);
					expect(graphResult.ok).toBe(true);
				}

				storage.close();
			});

			test(`centrality computation (${size} nodes)`, () => {
				const graph = GraphIndex.fromArtifacts(artifacts);

				const degStart = performance.now();
				const degree = graph.degreeCentrality();
				const degElapsed = performance.now() - degStart;

				const betStart = performance.now();
				const betweenness = graph.betweennessCentrality();
				const betElapsed = performance.now() - betStart;

				console.log(
					`  Degree centrality (${size} nodes): ${degElapsed.toFixed(2)}ms`,
				);
				console.log(
					`  Betweenness centrality (${size} nodes): ${betElapsed.toFixed(2)}ms`,
				);

				expect(degree.length).toBe(size);
				expect(betweenness.length).toBe(size);
			});

			test(`community detection (${size} nodes)`, () => {
				const graph = GraphIndex.fromArtifacts(artifacts);

				const start = performance.now();
				const result = graph.communities();
				const elapsed = performance.now() - start;

				console.log(
					`  Louvain communities (${size} nodes): ${elapsed.toFixed(2)}ms`,
				);

				expect(result.ok).toBe(true);
				if (result.ok) {
					console.log(`    → ${result.value.length} communities detected`);
				}
			});

			test(`connected components (${size} nodes)`, () => {
				const graph = GraphIndex.fromArtifacts(artifacts);

				const start = performance.now();
				const components = graph.connectedComponents();
				const elapsed = performance.now() - start;

				console.log(
					`  Connected components (${size} nodes): ${elapsed.toFixed(2)}ms`,
				);
				console.log(`    → ${components.length} components`);

				expect(components.length).toBeGreaterThanOrEqual(1);
			});

			test(`shortest path (${size} nodes)`, () => {
				const graph = GraphIndex.fromArtifacts(artifacts);

				// Pick two distant nodes
				const from = "node-0";
				const to = `node-${Math.floor(size / 2)}`;

				const start = performance.now();
				const result = graph.shortestPath(from, to);
				const elapsed = performance.now() - start;

				console.log(
					`  Shortest path ${from}→${to} (${size} nodes): ${elapsed.toFixed(2)}ms`,
				);

				expect(result.ok).toBe(true);
				if (result.ok && result.value) {
					console.log(
						`    → path length: ${result.value.length}, hops: [${result.value.path.slice(0, 5).join("→")}${result.value.path.length > 5 ? "→..." : ""}]`,
					);
				}
			});
		});
	}

	test("memory overhead estimation (1000 nodes)", () => {
		const artifacts = generateGraph(1000);

		const beforeHeap = process.memoryUsage().heapUsed;
		const graph = GraphIndex.fromArtifacts(artifacts);
		const afterHeap = process.memoryUsage().heapUsed;

		const overhead = (afterHeap - beforeHeap) / (1024 * 1024);
		console.log(`  Memory overhead (1000 nodes): ~${overhead.toFixed(2)}MB`);

		// Success criteria: < 10MB for 1000 artifacts
		expect(overhead).toBeLessThan(10);

		// Keep reference to prevent GC
		expect(graph.nodeCount()).toBe(1000);
	});
});
