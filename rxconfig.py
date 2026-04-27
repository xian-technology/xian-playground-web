"""Reflex runtime configuration for the playground app."""

from __future__ import annotations

import os

import reflex as rx


# Disable SSR/prerendered HTML to avoid hydration mismatches behind the proxy.
os.environ.setdefault("REFLEX_SSR", "0")

config = rx.Config(
    app_name="playground",
    deploy_url="https://playground.xian.technology",
    api_url="https://playground.xian.technology",
    frontend_port=3000,
    backend_port=8000,
    show_built_with_reflex=False,
    disable_plugins=[rx.plugins.SitemapPlugin()],
)
