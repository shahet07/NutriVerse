from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    firebase_id_token: str = Field(min_length=10)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


class LogoutRequest(BaseModel):
    access_token: str = Field(min_length=10)
    refresh_token: str = Field(min_length=10)


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    access_token_expires_in: int
    refresh_token_expires_in: int
