# Kestrel

A lightweight hybrid search library for structured document collections: BM25 keyword
matching combined with embedding-based semantic search, with a clean Python API and
zero mandatory infrastructure dependencies.

**GitHub**: [github.com/danielperegolise/kestrel](https://github.com/danielperegolise/kestrel)

---

## The problem

Most search libraries are either too heavy (Elasticsearch, OpenSearch — operational overhead
for small corpora) or too simple (basic substring matching). The tools that combine keyword
and semantic search generally require a running service and a vector database.

For 90% of the use cases I run into — internal tools, document-backed agents, small-corpus
search for portfolios or wikis — the sweet spot is: pure Python, no external services,
sub-second latency on corpora up to ~100k documents, and results that are actually good.

---

## What it does

- **BM25 indexing** over tokenized document fields (title, body, tags)
- **Embedding-based semantic search** using any sentence-transformer model; defaults to
  `all-MiniLM-L6-v2` (fast, 22M params, good enough for most purposes)
- **Hybrid reranking**: RRF (Reciprocal Rank Fusion) to blend keyword and semantic scores;
  configurable weight
- **Structured documents**: schema-validated at index time; search results include field-level
  highlights and a structured `SearchResult` object
- **Persistence**: serialize the full index (BM25 + embedding matrix) to a single `.kestrel`
  file; reload in ~50ms for a 10k-doc corpus

---

## Usage

```python
from kestrel import Index, Document

idx = Index()
idx.add([
    Document(id="1", title="Getting started", body="..."),
    Document(id="2", title="Advanced usage", body="..."),
])

results = idx.search("how do I configure the timeout", top_k=5)
for r in results:
    print(r.id, r.score, r.highlights)
```

---

## Status

Active, used in production for the portfolio agent's search backend and an internal
documentation tool at Helix. Accepting issues and PRs.

---

## Stack

Python 3.11+, rank-bm25, sentence-transformers, numpy, pydantic
