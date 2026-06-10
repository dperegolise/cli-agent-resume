"""
LangChain tool definitions: search_portfolio and focus_item.

Strategy §6: exactly two tools, no others.
"""

from __future__ import annotations

from typing import List

from langchain_core.tools import tool

import manifest as manifest_module
from manifest import SearchResult


@tool
def search_portfolio(query: str) -> List[SearchResult]:
    """
    Search the portfolio for content matching the query.
    Returns ranked results with location metadata.

    Args:
        query: Search string (e.g., 'machine learning projects')

    Returns:
        List of search results, each with:
        - path: File path (e.g., 'projects/ml-pipeline.md')
        - title: Display name
        - excerpt: ~150-char preview of matching content
        - section: Category ('experience', 'projects', 'about')
        - score: Relevance score (0-1)
    """
    return manifest_module.search(query)


@tool
def focus_item(path: str) -> str:
    """
    Navigate to a portfolio item and highlight it in the UI.
    The browser will load the file in the editor and highlight it in the file explorer.

    Args:
        path: File path in the manifest (e.g., 'projects/my-project.md')

    Returns:
        Confirmation message or error string if path is invalid.
    """
    # Security: reject anything that looks like a path traversal
    if ".." in path or path.startswith("/"):
        return f"Error: invalid path '{path}' — path traversal is not allowed."

    # Strip leading www/ prefix — manifest paths are relative to www/
    if path.startswith("www/"):
        path = path[4:]

    # Runtime validation against the manifest
    if not manifest_module.validate_path(path):
        return (
            f"Error: '{path}' is not in the portfolio manifest. "
            "Use search_portfolio to find valid paths."
        )

    content = manifest_module.get_content(path)
    return f"Navigated to {path}\n\n{content}"
