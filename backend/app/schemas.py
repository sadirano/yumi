from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ItemKind = Literal["youtube", "url", "file", "note"]
ItemStatus = Literal["to-watch", "watching", "watched", "archived"]


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    count: int = 0


class ItemBase(BaseModel):
    title: str = ""
    description: str = ""
    notes_md: str = ""
    thumbnail_url: Optional[str] = None
    channel: str = ""
    duration_sec: Optional[int] = None
    published_at: Optional[str] = None
    source: str = ""
    status: ItemStatus = "to-watch"


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: ItemKind
    url: Optional[str] = None
    file_path: Optional[str] = None
    needs_enrichment: bool = False
    deleted_at: Optional[str] = None
    created_at: str
    updated_at: str
    tags: list[TagOut] = Field(default_factory=list)


class ItemCreate(BaseModel):
    url: Optional[str] = None
    file_path: Optional[str] = None
    note_title: Optional[str] = None
    note_body: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    status: ItemStatus = "to-watch"
    source: str = ""
    notes_md: str = ""


class ItemPatch(BaseModel):
    title: Optional[str] = None
    notes_md: Optional[str] = None
    status: Optional[ItemStatus] = None
    source: Optional[str] = None
    tags: Optional[list[str]] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None


class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int
    title: str
    notes_md: str
    tags_json: str
    source: str
    status: str
    created_at: str


class SpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    namespaces: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    created_at: str


class SpaceCreate(BaseModel):
    name: str
    namespaces: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class SpacePatch(BaseModel):
    name: Optional[str] = None
    namespaces: Optional[list[str]] = None
    tags: Optional[list[str]] = None


class DuplicateError(BaseModel):
    detail: str = "duplicate"
    existing: ItemOut


class SavedFilterCreate(BaseModel):
    name: str
    params: dict = Field(default_factory=dict)


class SavedFilterPatch(BaseModel):
    name: Optional[str] = None
    params: Optional[dict] = None


class SavedFilterOut(BaseModel):
    id: int
    space_id: int
    name: str
    params: dict = Field(default_factory=dict)
    created_at: str
