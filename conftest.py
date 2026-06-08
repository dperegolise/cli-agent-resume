"""
conftest.py — Root conftest ensuring the worktree root is on sys.path.
This enables `from src.routr.main import app` style imports in tests.
"""
import sys
import os

# Add the worktree root to sys.path so `src.routr` is importable
sys.path.insert(0, os.path.dirname(__file__))
