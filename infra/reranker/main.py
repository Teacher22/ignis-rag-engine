from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder
import uvicorn

app = FastAPI()
model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    top_n: int = 5


class RerankResult(BaseModel):
    index: int
    relevanceScore: float


@app.post("/rerank")
def rerank(req: RerankRequest) -> dict:
    pairs = [[req.query, doc] for doc in req.documents]
    scores = model.predict(pairs)

    results = sorted(
        [{"index": i, "relevanceScore": float(s)} for i, s in enumerate(scores)],
        key=lambda x: x["relevanceScore"],
        reverse=True,
    )[: req.top_n]

    return {"results": results}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
