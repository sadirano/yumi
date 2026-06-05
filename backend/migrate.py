from app.db import engine, SessionLocal
from sqlalchemy import text

session = SessionLocal()
try:
    session.execute(text("ALTER TABLE spaces ADD COLUMN templates_json TEXT NOT NULL DEFAULT '[]'"))
    session.commit()
    print("Added templates_json to spaces table")
except Exception as e:
    print(e)
