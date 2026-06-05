from fastapi import APIRouter
from pydantic import BaseModel
from ..ai import ask_ai

router = APIRouter(prefix="/api/ai", tags=["ai"])

class AIRequest(BaseModel):
    prompt: str

@router.post("/ask")
async def ask(req: AIRequest):
    response = await ask_ai(req.prompt)
    return {"response": response}
