from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_dir() -> Path:
    """Per-user data directory under a shared 'sadirano' domain folder.

    Windows: %LOCALAPPDATA%\\sadirano\\yumi
    macOS:   ~/Library/Application Support/sadirano/yumi
    Linux:   $XDG_DATA_HOME/sadirano/yumi  (or ~/.local/share/sadirano/yumi)

    Keeps the user's library out of the repo so the source tree stays clean and
    nothing personal is ever committed. Override with YUMI_DATA_DIR.
    """
    domain = "sadirano"
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


settings = Settings()
