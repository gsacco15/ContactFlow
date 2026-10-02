#!/usr/bin/env python3
"""Zip package/ into contactflow-plugin.zip, the file you upload in ChatGPT (Admin > Plugins) or the
OpenAI plugin portal. plugin.json sits at the archive root.

  python3 extras/chatgpt-plugin/build_package.py                       # listing + skill + assets
  python3 extras/chatgpt-plugin/build_package.py --app-id asdk_app_…   # also link the ContactFlow app

The app id comes from ChatGPT after you create the ContactFlow app (Settings > Apps); it starts with
asdk_app_. It goes in .app.json, never as an mcp.json server (that would mark the plugin Desktop only).
"""
import json, sys, zipfile
from pathlib import Path

here = Path(__file__).resolve().parent
pkg = here / "package"
out = here / "contactflow-plugin.zip"

app_id = sys.argv[sys.argv.index("--app-id") + 1] if "--app-id" in sys.argv else None
if app_id and not app_id.startswith(("asdk_app_", "connector_", "templated_apps_")):
    sys.exit(f"app id should start with asdk_app_ (got {app_id!r}); use the app's id, not a plugin_ id")

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(pkg.rglob("*")):
        if f.is_file() and f.name != ".DS_Store":
            z.write(f, f.relative_to(pkg).as_posix())
    if app_id:
        z.writestr(".app.json", json.dumps({"apps": {"contactflow": {"id": app_id, "required": True}}}, indent=2) + "\n")

print(f"wrote {out.relative_to(here.parent.parent)}" + ("" if app_id else "  (no app linked: pass --app-id once the ChatGPT app exists)"))
