from pydantic import BaseModel


class StartMessage(BaseModel):
    type: str
    format: str
    sampleRate: int
    channels: int
