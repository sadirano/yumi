# PyInstaller spec for the frozen yumi server (Windows, one-dir build).
#
# Build from the backend/ dir, after the frontend SPA has been built into
# app/static (npm run build):  pyinstaller --noconfirm --clean yumi.spec
# Output: dist/yumi/yumi.exe (+ _internal/). build.cmd ties the whole thing
# together and zips the result for a GitHub release / Scoop manifest.
from PyInstaller.utils.hooks import collect_submodules

# uvicorn lazily imports its protocol/loop backends; pull them all in so the
# exe doesn't ModuleNotFoundError at startup. run_server.py also pins
# loop/http/ws to shrink what's actually reached.
hiddenimports = collect_submodules("uvicorn")

a = Analysis(
    ["run_server.py"],
    pathex=[],
    binaries=[],
    # Bundle the built SPA. Must match STATIC_DIR in app/main.py
    # (sys._MEIPASS / "app" / "static").
    datas=[("app/static", "app/static")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # yt-dlp is intentionally NOT bundled — the frozen build shells out to a
    # yt-dlp.exe declared as a Scoop dependency (see app/enrich.py). Excluding it
    # here keeps PyInstaller from dragging in yt-dlp's huge extractor tree.
    excludes=["yt_dlp", "pytest", "_pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="yumi",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # console=True: yumi is a server; printing the listen URL and logs to a
    # console is useful and standard for a Scoop CLI. The autostart layer (noir)
    # is responsible for launching it hidden if a window is unwanted.
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="yumi",
)
