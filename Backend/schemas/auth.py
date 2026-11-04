from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    firebase_id_token: str = Field(min_length=10)


class DevLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+$")
    name: str | None = Field(default=None, max_length=100)


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
