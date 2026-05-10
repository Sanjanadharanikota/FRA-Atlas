from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from db import create_user, get_user_by_email
from utils.api_utils import success_response
from utils.auth_utils import get_current_user
from utils.security_utils import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _validate_email(email: str) -> str:
    normalized = email.strip().lower()
    if "@" not in normalized or "." not in normalized.split("@")[-1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid email address is required")
    return normalized


class SignupPayload(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str
    password: str = Field(min_length=8, max_length=128)


class LoginPayload(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)


@router.post("/signup")
def signup(payload: SignupPayload):
    email = _validate_email(payload.email)
    existing = get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    user = create_user(email, payload.full_name, hash_password(payload.password), role="analyst")
    token = create_access_token(str(user["id"]), user["role"])
    return success_response(
        {
            "token": token,
            "user": {
                "id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"],
                "role": user["role"],
            },
        },
        message="Account created successfully",
    )


@router.post("/login")
def login(payload: LoginPayload):
    user = get_user_by_email(_validate_email(payload.email))
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive")

    token = create_access_token(str(user["id"]), user["role"])
    return success_response(
        {
            "token": token,
            "user": {
                "id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"],
                "role": user["role"],
            },
        },
        message="Login successful",
    )


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return success_response(
        {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "role": user["role"],
        },
        message="Authenticated user loaded",
    )
