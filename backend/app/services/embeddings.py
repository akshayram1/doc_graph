from collections.abc import Iterable, Sequence
from functools import lru_cache

from fastembed import SparseTextEmbedding
from qdrant_client import models

BM25_MODEL_NAME = "Qdrant/bm25"


@lru_cache
def get_encoder() -> SparseTextEmbedding:
    return SparseTextEmbedding(model_name=BM25_MODEL_NAME)


def _to_sparse_vector(embedding) -> models.SparseVector:
    return models.SparseVector(
        indices=embedding.indices.tolist(),
        values=embedding.values.tolist(),
    )


def encode_documents(texts: Sequence[str]) -> list[models.SparseVector]:
    embeddings: Iterable = get_encoder().embed(list(texts))
    return [_to_sparse_vector(embedding) for embedding in embeddings]


def encode_query(text: str) -> models.SparseVector:
    embedding = next(iter(get_encoder().query_embed(text)))
    return _to_sparse_vector(embedding)
