import sys
import os

# Add backend/ to sys.path so bare imports (manifest, cascade, etc.) resolve
# when pytest is run from the repo root via `pytest backend/`
sys.path.insert(0, os.path.dirname(__file__))
