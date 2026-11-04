from pydantic import BaseModel, Field


class Relation(BaseModel):
    target: str = Field(description="Key of the related node")
    type: str = Field(default="related_to")


class NodeInput(BaseModel):
    key: str = Field(description="Stable human-readable identifier")
    label: str
    text: str
    type: str = Field(default="concept")
    relations: list[Relation] = Field(default_factory=list)


class IngestRequest(BaseModel):
    nodes: list[NodeInput]
    graph_id: str


class IngestResponse(BaseModel):
    ingested: int
    collection: str


class SearchRequest(BaseModel):
    query: str
    limit: int | None = None
    graph_ids: list[str] | None = None


class SearchHit(BaseModel):
    uid: str = Field(description="graph_id:key, unique across graphs")
    key: str
    graph_id: str
    label: str
    type: str
    text: str
    score: float


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]


class GraphNode(BaseModel):
    uid: str
    key: str
    graph_id: str
    label: str
    type: str
    text: str | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str
    cross: bool = Field(default=False, description="Links the same entity in two documents")


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# ---------------------------------------------------------------- documents / graphs


class GraphInfo(BaseModel):
    id: str
    name: str
    filename: str
    color: str
    node_count: int
    edge_count: int
    created_at: str


class GraphDeleteResponse(BaseModel):
    id: str
    deleted_nodes: int


# ---------------------------------------------------------------- chat


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    limit: int | None = None
    graph_ids: list[str] | None = None


class ChatResponse(BaseModel):
    answer: str
    model: str
    sources: list[SearchHit]


class StoredMessage(BaseModel):
    id: str
    role: str
    content: str
    created_at: str
    graph_ids: list[str] = Field(default_factory=list)
    sources: list[SearchHit] = Field(default_factory=list)


class ChatSummary(BaseModel):
    id: str
    title: str
    graph_ids: list[str]
    created_at: str
    updated_at: str
    message_count: int
    last_message: str


class ChatSession(BaseModel):
    id: str
    title: str
    graph_ids: list[str]
    created_at: str
    updated_at: str
    messages: list[StoredMessage]


class ChatCreate(BaseModel):
    title: str | None = None
    graph_ids: list[str] = Field(default_factory=list)


class ChatUpdate(BaseModel):
    title: str | None = None
    graph_ids: list[str] | None = None


class ChatSend(BaseModel):
    message: str
    graph_ids: list[str] | None = Field(
        default=None, description="Graphs to answer from; defaults to the chat's scope"
    )


class ChatTurn(BaseModel):
    chat: ChatSession
    reply: StoredMessage


# ---------------------------------------------------------------- misc


class ClearResponse(BaseModel):
    deleted: int
    collection: str


class UploadResponse(BaseModel):
    graph: GraphInfo
    extracted_nodes: int
    ingested_nodes: int
    collection: str
