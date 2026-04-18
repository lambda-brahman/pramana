// throwaway — extract queries from judged/corpora/*.ts into JSON for the Rust bin.
import { queries as qa } from "./judged/corpora/corpus-a";
import { queries as qb } from "./judged/corpora/corpus-b";
import { queries as qc } from "./judged/corpora/corpus-c";
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync(`${import.meta.dir}/judged/corpora`, { recursive: true });
writeFileSync(`${import.meta.dir}/judged/corpora/corpus-a.queries.json`, JSON.stringify(qa, null, 2));
writeFileSync(`${import.meta.dir}/judged/corpora/corpus-b.queries.json`, JSON.stringify(qb, null, 2));
writeFileSync(`${import.meta.dir}/judged/corpora/corpus-c.queries.json`, JSON.stringify(qc, null, 2));
console.log(`wrote ${qa.length + qb.length + qc.length} queries across 3 corpora`);
