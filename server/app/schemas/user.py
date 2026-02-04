from datetime import datetime

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    username: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
