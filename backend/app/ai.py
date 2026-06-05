from __future__ import annotations

import httpx
import logging
from typing import Tuple

from .settings import settings

log = logging.getLogger(__name__)

from sqlalchemy.orm import Session

async def process_with_ai(title: str, description: str, current_notes: str, user_tags: list[str], db: Session) -> Tuple[list[str], str]:
    providers = settings.ai_providers
    if not providers:
        return user_tags, current_notes
    ns_instruction = ""
    if db:
        from .models import Space
        import json
        from .models import Space, Tag
        spaces = db.query(Space).all()
        all_tags = [t.name for t in db.query(Tag).all()]
        
        # Try to guess the space this item belongs to based on user_tags
        matched_space = None
        for s in spaces:
            try:
                space_tags = json.loads(s.tags_json)
                if space_tags and all(t in user_tags for t in space_tags):
                    matched_space = s
                    break
            except Exception: pass
            
        all_namespaces = set()
        if matched_space:
            try:
                all_namespaces.update(json.loads(matched_space.namespaces_json))
            except Exception: pass
        else:
            for s in spaces:
                try:
                    all_namespaces.update(json.loads(s.namespaces_json))
                except Exception: pass
                
        if all_namespaces:
            filtered_tags = [t for t in all_tags if any(t.startswith(f"{ns}:") for ns in all_namespaces)]
            all_tags = filtered_tags if filtered_tags else all_tags
            
        tags_str = ", ".join(all_tags)
        tag_instruction = f"Here are the existing tags in this space context: {tags_str}. Prefer reusing these if they apply, but you CAN create new ones following the same namespacing idea."
        
        if all_namespaces:
            ns_str = ", ".join(sorted(all_namespaces))
            ns_instruction = f"\nAvailable tag scopes: {ns_str}. EVERY SINGLE TAG YOU SUGGEST MUST HAVE ONE OF THESE NAMESPACES (e.g., 'genre:romance' instead of just 'romance'). DO NOT suggest any tag without a colon (':').\nIf the 'acg:' scope is available, use it specifically for Anime, Comic, and Game related tropes, themes, or elements (e.g., 'acg:tsundere', 'acg:mecha', 'acg:isekai', 'acg:war')."

    prompt = f"""You are an assistant for a personal bookmarking/library app.
Given the following item:
Title: {title}
Description: {description}

Please provide:
1. A 1-2 sentence summary of what this item is about.
2. A comma-separated list of 3-5 tags that categorize this item. Use lowercase, dash-separated tags. {tag_instruction if db else ""} EVERY TAG MUST HAVE A NAMESPACE (e.g., 'type:video'). DO NOT provide bare tags.{ns_instruction}
Do not include any tags that are exactly in this list: {user_tags}

Format your response exactly like this:
SUMMARY: <your summary>
TAGS: <tag1>, <tag2>, <tag3>
"""



    async with httpx.AsyncClient(timeout=30.0) as client:
        for i, p in enumerate(providers):
            try:
                resp = await client.post(
                    f"{p['url'].rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {p['key']}"},
                    json={
                        "model": p["model"],
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                    }
                )
                
                # Fallback if rate limited or service unavailable
                if resp.status_code in (429, 500, 503, 529) and i < len(providers) - 1:
                    log.warning(f"Provider {p['url']} ({p['model']}) hit limit/error ({resp.status_code}). Trying fallback...")
                    continue
                    
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"].strip()
                
                summary_part = ""
                tags_part = []
                
                for line in content.split("\n"):
                    line = line.strip()
                    if line.startswith("SUMMARY:"):
                        summary_part = line.replace("SUMMARY:", "").strip()
                    elif line.startswith("TAGS:"):
                        tags_str = line.replace("TAGS:", "").strip()
                        if tags_str:
                            tags_part = [t.strip().lower() for t in tags_str.split(",") if t.strip()]
                
                new_notes = current_notes
                if summary_part:
                    if new_notes:
                        new_notes = f"> {summary_part}\n\n{new_notes}"
                    else:
                        new_notes = f"> {summary_part}"
                        
                combined_tags = list(set(user_tags + tags_part))
                return combined_tags, new_notes
                
            except Exception as e:
                log.warning(f"AI processing failed for provider {p['url']} ({p['model']}): {e}")
                if i == len(providers) - 1:
                    return user_tags, current_notes
                continue
        
    return user_tags, current_notes

async def ask_ai(prompt: str) -> str:
    from fastapi import HTTPException
    providers = settings.ai_providers
    if not providers:
        raise HTTPException(status_code=400, detail="No AI providers configured in settings.")
        
    async with httpx.AsyncClient(timeout=60.0) as client:
        for i, p in enumerate(providers):
            try:
                resp = await client.post(
                    f"{p['url'].rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {p['key']}"},
                    json={
                        "model": p["model"],
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.5,
                    }
                )
                
                if resp.status_code in (429, 500, 503, 529) and i < len(providers) - 1:
                    log.warning(f"Provider {p['url']} ({p['model']}) hit limit/error ({resp.status_code}). Trying fallback...")
                    continue
                    
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
                
            except Exception as e:
                log.warning(f"AI query failed for provider {p['url']} ({p['model']}): {e}")
                if i == len(providers) - 1:
                    raise HTTPException(status_code=502, detail=f"AI query failed: {str(e)}")
                continue
                
    raise HTTPException(status_code=500, detail="Unknown error occurred during AI query.")
