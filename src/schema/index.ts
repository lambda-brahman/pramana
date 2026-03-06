import { z } from "zod";

export const RELATIONSHIP_TYPES = [
  "has",       // source contains target as a component
  "of",        // source is a component of target (inverse of has)
  "needs",     // source requires target to function
  "feeds",     // source provides output consumed by target
  "impl",      // source implements the contract defined by target
  "produces",  // source creates/emits target as output
  "consumes",  // source takes target as input
  "refs",      // narrative reference (default for wikilinks)
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
  z.union([z.string(), z.array(z.string())])
);
