import { z } from "zod";

export const RelationshipSchema = z.object({
  target: z.string(),
  type: z.string(),
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
  z.string(),
  z.union([z.string(), z.array(z.string())])
);
