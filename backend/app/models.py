from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    notes_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel: Mapped[str] = mapped_column(Text, nullable=False, default="")
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    published_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="plan")
    # Serialized-media progress. `progress` = episodes/chapters consumed;
    # `total` = the work's length, or NULL when ongoing/unknown. "Finished" is
    # derived (total is not None and progress >= total), never stored.
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    needs_enrichment: Mapped[bool] = mapped_column(default=False)
    # Usage metrics: bumped only by an explicit open-the-resource click (see the
    # /access endpoint), never by passive reads. last_accessed_at is ISO or NULL.
    access_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_accessed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    deleted_at: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, onupdate=utcnow_iso)

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="item_tags", back_populates="items", lazy="selectin"
    )

class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    items: Mapped[list[Item]] = relationship(
        "Item", secondary="item_tags", back_populates="tags"
    )


class ItemTag(Base):
    __tablename__ = "item_tags"

    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class ItemRevision(Base):
    __tablename__ = "item_revisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    notes_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="plan")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utcnow_iso)


class Space(Base):
    __tablename__ = "spaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    namespaces_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # JSON map of canonical status -> custom display label for this Space's 3
    # active states (plan/in-progress/completed). NULL = use canonical defaults.
    labels_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    note_template_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    templates_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)


class SpaceFilter(Base):
    """A named, Space-owned snapshot of the Library filter state. Membership is
    live: applying it rewrites the URL query params, which the item query engine
    ANDs on top of the owning Space's predicate."""

    __tablename__ = "space_filters"

    id: Mapped[int] = mapped_column(primary_key=True)
    space_id: Mapped[int] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON object of persisted query params (q, tagExpr, tags, exclude_tags,
    # tag_op, status_in, sort) — i.e. the URL params minus space/limit/offset.
    params_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
