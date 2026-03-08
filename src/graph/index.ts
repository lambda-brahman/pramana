import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { connectedComponents } from "graphology-components";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import { degreeCentrality } from "graphology-metrics/centrality/degree";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { bfsFromNode } from "graphology-traversal";
import { err, ok, type Result } from "../lib/result.ts";
import type { KnowledgeArtifact } from "../schema/index.ts";

export type GraphError = { type: "graph"; message: string };

export type GraphMetrics = {
  nodeCount: number;
  edgeCount: number;
  density: number;
};

export type CentralityEntry = {
  slug: string;
  score: number;
};

export type Community = {
  id: number;
  members: string[];
};

export type ShortestPath = {
  path: string[];
  length: number;
};

export type Component = {
  id: number;
  members: string[];
};

export class GraphIndex {
  private graph: Graph;

  private constructor(graph: Graph) {
    this.graph = graph;
  }

  static fromArtifacts(artifacts: KnowledgeArtifact[]): GraphIndex {
    const graph = new Graph({ multi: true, type: "directed" });

    for (const artifact of artifacts) {
      if (!graph.hasNode(artifact.slug)) {
        graph.addNode(artifact.slug, {
          title: artifact.title,
          tags: artifact.tags,
        });
      }
    }

    for (const artifact of artifacts) {
      for (const rel of artifact.relationships) {
        const targetSlug = rel.target.split("#")[0]!;
        if (graph.hasNode(targetSlug)) {
          graph.addEdge(artifact.slug, targetSlug, {
            type: rel.type,
          });
        }
      }
    }

    return new GraphIndex(graph);
  }

  metrics(): GraphMetrics {
    const nodeCount = this.graph.order;
    const edgeCount = this.graph.size;
    const density = nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;
    return { nodeCount, edgeCount, density };
  }

  degreeCentrality(): CentralityEntry[] {
    const scores = degreeCentrality(this.graph);
    return toSortedEntries(scores);
  }

  betweennessCentrality(): CentralityEntry[] {
    const scores = betweennessCentrality(this.graph);
    return toSortedEntries(scores);
  }

  communities(): Result<Community[], GraphError> {
    if (this.graph.order === 0) {
      return ok([]);
    }

    // Louvain requires an undirected graph
    const undirected = new Graph({ type: "undirected" });
    this.graph.forEachNode((node, attrs) => {
      undirected.addNode(node, attrs);
    });
    this.graph.forEachEdge((_edge, _attrs, source, target) => {
      if (!undirected.hasEdge(source, target)) {
        undirected.addEdge(source, target);
      }
    });

    const assignments = louvain(undirected);

    const communityMap = new Map<number, string[]>();
    for (const [node, communityId] of Object.entries(assignments)) {
      const members = communityMap.get(communityId) ?? [];
      members.push(node);
      communityMap.set(communityId, members);
    }

    const result: Community[] = [];
    for (const [id, members] of communityMap) {
      result.push({ id, members: members.sort() });
    }

    return ok(result.sort((a, b) => b.members.length - a.members.length));
  }

  shortestPath(from: string, to: string): Result<ShortestPath | null, GraphError> {
    if (!this.graph.hasNode(from)) {
      return err({ type: "graph", message: `Node not found: ${from}` });
    }
    if (!this.graph.hasNode(to)) {
      return err({ type: "graph", message: `Node not found: ${to}` });
    }

    const path = bidirectional(this.graph, from, to);
    if (!path) return ok(null);

    return ok({ path, length: path.length - 1 });
  }

  connectedComponents(): Component[] {
    const components = connectedComponents(this.graph);

    return components
      .map((members, idx) => ({
        id: idx,
        members: members.sort(),
      }))
      .sort((a, b) => b.members.length - a.members.length);
  }

  traverse(from: string, relType?: string, depth = 1): Result<string[], GraphError> {
    if (!this.graph.hasNode(from)) {
      return err({ type: "graph", message: `Node not found: ${from}` });
    }

    const visited = new Set<string>();
    const results: string[] = [];

    bfsFromNode(this.graph, from, (node, _attrs, currentDepth) => {
      if (currentDepth > depth) return true; // stop traversal
      if (node === from) return false; // skip root

      if (relType) {
        const edges = this.graph.inboundEdges(node);
        const hasMatchingEdge = edges.some((edge) => {
          const source = this.graph.source(edge);
          if (!visited.has(source) && source !== from) return false;
          return this.graph.getEdgeAttribute(edge, "type") === relType;
        });

        const directEdges = this.graph.outboundEdges(from);
        const hasDirectMatch = directEdges.some((edge) => {
          const target = this.graph.target(edge);
          return target === node && this.graph.getEdgeAttribute(edge, "type") === relType;
        });

        if (!hasMatchingEdge && !hasDirectMatch && currentDepth === 1) {
          return false;
        }
      }

      if (!visited.has(node)) {
        visited.add(node);
        results.push(node);
      }
      return false;
    });

    return ok(results);
  }

  neighbors(slug: string): Result<string[], GraphError> {
    if (!this.graph.hasNode(slug)) {
      return err({ type: "graph", message: `Node not found: ${slug}` });
    }
    return ok(this.graph.neighbors(slug));
  }

  nodeCount(): number {
    return this.graph.order;
  }

  edgeCount(): number {
    return this.graph.size;
  }
}

function toSortedEntries(scores: Record<string, number>): CentralityEntry[] {
  return Object.entries(scores)
    .map(([slug, score]) => ({ slug, score }))
    .sort((a, b) => b.score - a.score);
}
