import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "dbname":   os.getenv("DB_NAME"),
    "user":     os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "host":     os.getenv("DB_HOST"),
    "port":     os.getenv("DB_PORT"),
}

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

HF_TOKEN = os.getenv("HF_TOKEN")

BASE_DIR      = Path(__file__).resolve().parent
ARTIFACTS_DIR = BASE_DIR / "artifacts"

RAWG_API_KEYS = [
    v for k in [
        "RAWG_API_KEY", *(f"RAWG_API_KEY_{i}" for i in range(1, 16))
    ]
    if (v := os.getenv(k))
]
