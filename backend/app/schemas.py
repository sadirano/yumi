from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ItemKind = Literal["youtube", "url", "file", "note"]
ItemStatus = Literal["plan", "in-progress", "completed", "archived"]


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    count: int = 0


class RelatedLink(BaseModel):
    label: str = ""
    url: str


class ItemBase(BaseModel):
    title: str = ""
    description: str = ""
    notes_md: str = ""
    thumbnail_url: Optional[str] = None
    channel: str = ""
    duration_sec: Optional[int] = None
    published_at: Optional[str] = None
    status: ItemStatus = "plan"
    progress: int = 0
    total: Optional[int] = None
    anilist_id: Optional[int] = None
    related_links: list[RelatedLink] = Field(default_factory=list)


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: ItemKind
    url: Optional[str] = None
    file_path: Optional[str] = None
    needs_enrichment: bool = False
    access_count: int = 0
    last_accessed_at: Optional[str] = None
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
    status: ItemStatus = "plan"
    notes_md: str = ""


class ItemPatch(BaseModel):
    title: Optional[str] = None
    notes_md: Optional[str] = None
    status: Optional[ItemStatus] = None
    tags: Optional[list[str]] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    progress: Optional[int] = None
    total: Optional[int] = None
    anilist_id: Optional[int] = None
    related_links: Optional[list[RelatedLink]] = None


class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int
    title: str
    notes_md: str
    tags_json: str
    status: str
    created_at: str


class SpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    namespaces: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    # Per-Space display labels overriding the 3 active statuses (plan,
    # in-progress, completed). `archived` stays fixed; null = canonical defaults.
    labels: Optional[dict[str, str]] = None
    created_at: str


class SpaceCreate(BaseModel):
    name: str
    namespaces: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    labels: Optional[dict[str, str]] = None


class SpacePatch(BaseModel):
    name: Optional[str] = None
    namespaces: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    labels: Optional[dict[str, str]] = None


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
