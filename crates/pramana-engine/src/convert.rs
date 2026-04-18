use pramana_parser::KnowledgeArtifact;
use pramana_storage::Artifact;

pub fn artifact_to_storage(ka: &KnowledgeArtifact) -> Artifact {
    Artifact {
        slug: ka.slug.clone(),
        title: ka.title.clone(),
        summary: ka.summary.clone(),
        aliases: ka.aliases.clone(),
        tags: ka.tags.clone(),
        content: ka.content.clone(),
        hash: ka.hash.clone(),
        relationships: ka.relationships.iter().map(relationship_to_storage).collect(),
        sections: ka.sections.iter().map(section_to_storage).collect(),
    }
}

fn relationship_to_storage(r: &pramana_parser::Relationship) -> pramana_storage::Relationship {
    pramana_storage::Relationship {
        target: r.target.clone(),
        kind: r.rel_type.as_str().to_owned(),
        line: r.line.map(|l| l as i64),
        section: r.section.clone(),
    }
}

fn section_to_storage(s: &pramana_parser::Section) -> pramana_storage::Section {
    pramana_storage::Section {
        id: s.id.clone(),
        heading: s.heading.clone(),
        level: s.level as i64,
        line: s.line as i64,
    }
}
