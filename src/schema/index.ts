import { z } from "zod";

export const RELATIONSHIP_TYPES = [
  "depends-on", // X cannot function without Y (directed, transitive)
  "relates-to", // X and Y are connected but neither requires the other
] as const;

export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipSchema = z.object({
  target: z.string(),
  type: RelationshipTypeSchema,
  line: z.number().optional(),
  section: z.string().optional(),
});

export const SectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  level: z.number(),
  line: z.number(),
});

export const KnowledgeArtifactSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  tags: z.array(z.string()),
  relationships: z.array(RelationshipSchema),
  sections: z.array(SectionSchema),
  content: z.string(),
  hash: z.string(),
});

export type Relationship = z.infer<typeof RelationshipSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type KnowledgeArtifact = z.infer<typeof KnowledgeArtifactSchema>;

export const FrontmatterRelationshipsSchema = z.record(
  RelationshipTypeSchema,
  z.union([z.string(), z.array(z.string())]),
);
