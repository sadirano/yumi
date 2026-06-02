from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_dir() -> Path:
    """Per-user data directory under a backup-oriented 'sadirano-data' domain.

    Windows: %LOCALAPPDATA%\\sadirano-data\\yumi
    macOS:   ~/Library/Application Support/sadirano-data/yumi
    Linux:   $XDG_DATA_HOME/sadirano-data/yumi  (or ~/.local/share/sadirano-data/yumi)

    The disposable venv lives under 'sadirano/yumi' (created by run.cmd); only
    backup-worthy state — the SQLite library — lives here under 'sadirano-data'
    so a backup tool can target that domain and skip the recreatable venv.
    Keeps the user's library out of the repo. Override with YUMI_DATA_DIR.
    """
    domain = "sadirano-data"
    app = "yumi"
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    return Path(base) / domain / app


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="YUMI_", env_file=".env", extra="ignore")

    data_dir: Path = Field(default_factory=_default_data_dir)
    db_filename: str = "favorites.sqlite"
    host: str = "127.0.0.1"
    port: int = 8765
    enrichment_timeout_sec: float = 15.0

    @property
    def db_path(self) -> Path:
        return self.data_dir / self.db_filename

    @property
    def db_url(self) -> str:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.db_path.as_posix()}"

    @property
    def uploads_dir(self) -> Path:
        path = self.data_dir / "uploads"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
