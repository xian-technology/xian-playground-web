from __future__ import annotations

import json
from typing import Any, Dict

import reflex as rx
from reflex.components.radix.themes.components.badge import Badge
from reflex.config import get_config
from starlette.requests import Request
from starlette.responses import RedirectResponse
from urllib.parse import unquote

from .components import MonacoEditor
from .services import ENVIRONMENT_FIELDS, SessionRepository, session_runtime
from .middleware import SessionCookieMiddleware, issue_session_cookie
from .state import PlaygroundState


# Modern dark theme color scheme inspired by blockchain explorers
COLORS = {
    "bg_primary": "#0a0a0b",
    "bg_secondary": "#151518",
    "bg_tertiary": "#1a1a1d",
    "border": "#27272a",
    "border_subtle": "#1f1f23",
    "text_primary": "#ffffff",
    "text_secondary": "#a1a1aa",
    "text_muted": "#71717a",
    "accent_purple": "#8b5cf6",
    "accent_blue": "#3b82f6",
    "accent_cyan": "#06b6d4",
    "success": "#10b981",
    "warning": "#f59e0b",
    "error": "#ef4444",
    "text_black": "#000000",
}


def card(
    *children,
    **kwargs,
) -> rx.Component:
    """Modern card component with dark theme styling."""
    default_style = {
        "background": COLORS["bg_secondary"],
        "border": f"1px solid {COLORS['border']}",
        "border_radius": "12px",
        "padding": "24px",
        "display": "flex",
        "flex_direction": "column",
        "gap": "16px",
        "width": "100%",
        "box_shadow": "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)",
        "max_height": "720px",
        "overflow": "hidden",
    }
    if kwargs.get("flex"):
        default_style.pop("max_height", None)
        default_style.pop("overflow", None)
    return rx.box(*children, **{**default_style, **kwargs})


def panel_expand_icon(panel_id: str) -> rx.Component:
    is_expanded = PlaygroundState.expanded_panel == panel_id
    icon_color = COLORS["text_secondary"]

    icon = rx.cond(
        is_expanded,
        rx.icon(tag="minimize_2", size=18, color=icon_color),
        rx.icon(tag="maximize_2", size=18, color=icon_color),
    )

    return rx.tooltip(
        rx.box(
            icon,
            on_click=lambda _: PlaygroundState.toggle_panel(panel_id),
            cursor="pointer",
            padding="6px",
            border_radius="999px",
            background=COLORS["bg_tertiary"],
            _hover={"background": COLORS["bg_secondary"]},
        ),
        content=rx.cond(
            is_expanded,
            "Exit fullscreen",
            "Toggle fullscreen",
        ),
        delay_duration=200,
    )


def section_header(
    title: str,
    description: str = "",
    panel_id: str | None = None,
    trailing: rx.Component | None = None,
    icon: str | None = None,
) -> rx.Component:
    """Section header with optional fullscreen icon and trailing controls."""

    heading_contents = []
    if icon:
        heading_contents.append(
            rx.icon(
                tag=icon,
                size=18,
                color=COLORS["accent_cyan"],
            )
        )
    heading_contents.append(
        rx.heading(
            title,
            size="5",
            color=COLORS["text_primary"],
            font_weight="600",
        )
    )

    title_row = rx.hstack(
        rx.hstack(
            *heading_contents,
            align_items="center",
            gap="8px",
        ),
        rx.spacer(),
        rx.cond(
            trailing is not None,
            trailing,
            rx.fragment(),
        ),
        rx.cond(
            panel_id is not None,
            panel_expand_icon(panel_id),
            rx.fragment(),
        ),
        align_items="center",
        width="100%",
        gap="12px",
    )

    description_el = rx.cond(
        description != "",
        rx.text(
            description,
            color=COLORS["text_secondary"],
            size="2",
            line_height="1.6",
        ),
        rx.fragment(),
    )

    return rx.vstack(
        title_row,
        description_el,
        gap="8px",
        align_items="start",
        width="100%",
    )


def code_viewer(
    value: str,
    language: str,
    empty_message: str,
    font_size: str = "14px",
    *,
    boxed: bool = True,
    style: Dict[str, Any] | None = None,
    container_style: Dict[str, Any] | None = None,
    style_overrides: Dict[str, Any] | None = None,
) -> rx.Component:
    """Reusable code viewer with optional container chrome."""

    def _viewer():
        viewer_style = {
            "margin": "0",
            "fontSize": font_size,
            "width": "100%",
        }
        if not boxed:
            viewer_style["flex"] = "1 1 auto"
            viewer_style["minHeight"] = "0"
        if style:
            viewer_style.update(style)
        return rx.code_block(
            value,
            language=language,
            wrap_lines=True,
            style=viewer_style,
            width="100%",
        )

    content = rx.cond(
        value == "",
        rx.text(
            empty_message,
            color=COLORS["text_secondary"],
            font_style="italic",
            font_size="14px",
        ),
        _viewer(),
    )

    if not boxed:
        return content

    container = {
        "width": "100%",
        "overflow": "auto",
        "background": COLORS["bg_tertiary"],
        "border": f"1px solid {COLORS['border']}",
        "borderRadius": "8px",
        "padding": "12px",
    }
    if container_style:
        container.update(container_style)
    box_props = container.copy()
    if style_overrides:
        box_props.update(style_overrides)
    return rx.box(content, **box_props)


def log_entry_item(entry):
    badge = rx.box(
        entry["level_label"],
        background=entry["color"],
        color="white",
        padding_x="8px",
        padding_y="4px",
        border_radius="999px",
        font_size="11px",
        font_weight="600",
        letter_spacing="0.02em",
        font_family="'Inter', sans-serif",
    )
    return rx.box(
        rx.vstack(
            rx.hstack(
                badge,
                rx.text(
                    entry["timestamp"],
                    color=COLORS["text_secondary"],
                    size="1",
                ),
                rx.spacer(),
                rx.text(
                    entry["action"],
                    color=COLORS["text_primary"],
                    font_weight="600",
                    size="2",
                ),
                align_items="center",
                width="100%",
                gap="8px",
            ),
            rx.text(
                entry["message"],
                color=COLORS["text_primary"],
                size="2",
            ),
            rx.cond(
                entry["detail"] == "",
                rx.fragment(),
                rx.text(
                    entry["detail"],
                    color=COLORS["text_secondary"],
                    font_family="'Fira Code', 'Monaco', 'Courier New', monospace",
                    font_size="12px",
                    white_space="pre-wrap",
                    background=COLORS["bg_secondary"],
                    border=f"1px solid {COLORS['border']}",
                    border_radius="8px",
                    padding="10px",
                    width="100%",
                ),
            ),
            spacing="3",
            width="100%",
        ),
        width="100%",
        padding="12px",
        border=f"1px solid {COLORS['border_subtle']}",
        border_radius="10px",
        background=COLORS["bg_secondary"],
    )


def panel_style(base_height: str | None, is_fullscreen: bool) -> Dict[str, Any]:
    """Create a consistent panel container style."""
    style: Dict[str, Any] = {
        "width": "100%",
        "display": "flex",
        "flexDirection": "column",
        "gap": "12px",
        "flex": "1 1 auto",
    }
    if is_fullscreen:
        style.update(
            {
                "height": "100%",
                "minHeight": "0",
            }
        )
    elif base_height:
        style.update(
            {
                "height": base_height,
                "minHeight": base_height,
                "maxHeight": base_height,
            }
        )
    return style


def panel_stack(
    *children: rx.Component,
    base_height: str | None,
    is_fullscreen: bool,
    spacing: str = "3",
    **box_kwargs: Dict[str, Any],
) -> rx.Component:
    """Wrap panel content in a consistent stack container."""
    stack = rx.vstack(
        *children,
        spacing=spacing,
        width="100%",
        flex="1 1 auto",
        min_height="0",
    )
    return rx.box(
        stack,
        style=panel_style(base_height, is_fullscreen),
        **box_kwargs,
    )


def resolve_panel_context(
    card_kwargs: Dict[str, Any] | None, base_height: str | None
) -> tuple[Dict[str, Any], bool, Dict[str, Any]]:
    """Normalize card kwargs and return fullscreen flag plus base style."""
    card_kwargs = card_kwargs or {}
    is_fullscreen = card_kwargs.get("flex") is not None
    return card_kwargs, is_fullscreen, panel_style(base_height, is_fullscreen)

def styled_input(**kwargs) -> rx.Component:
    """Styled input field with dark theme."""
    default_style = {
        "background": COLORS["bg_tertiary"],
        "border": f"1px solid {COLORS['border']}",
        "border_radius": "8px",
        "color": COLORS["text_primary"],
        "font_size": "14px",
        "_focus": {
            "border_color": COLORS["accent_cyan"],
            "outline": "none",
        },
    }
    return rx.input(**{**default_style, **kwargs})


def styled_text_area(**kwargs) -> rx.Component:
    """Styled text area with dark theme."""
    default_style = {
        "background": COLORS["bg_tertiary"],
        "border": f"1px solid {COLORS['border']}",
        "border_radius": "8px",
        "color": COLORS["text_primary"],
        "font_size": "14px",
        "resize": "vertical",
        "_focus": {
            "border_color": COLORS["accent_cyan"],
            "outline": "none",
        },
    }
    return rx.text_area(**{**default_style, **kwargs})


def session_panel() -> rx.Component:
    """Session controls and resume form."""

    row_direction = rx.breakpoints(initial="column", md="row")
    row_wrap = rx.breakpoints(initial="wrap", md="nowrap")
    buttons_direction = rx.breakpoints(initial="column", md="row")
    buttons_row_direction = rx.breakpoints(initial="column", md="row")
    buttons_justify = rx.breakpoints(initial="start", md="end")
    button_width = rx.breakpoints(initial="100%", md="auto")
    id_box_width = rx.breakpoints(initial="100%", md="280px")
    copy_container_width = rx.breakpoints(initial="100%", md="auto")
    input_width = id_box_width

    session_id_display = rx.code(
        rx.cond(
            PlaygroundState.session_id != "",
            PlaygroundState.session_id,
            "Pending...",
        ),
        color=COLORS["accent_cyan"],
        font_size="13px",
        font_family="'Fira Code', 'Monaco', 'Courier New', monospace",
        padding="6px 10px",
        background=COLORS["bg_tertiary"],
        border_radius="6px",
        letter_spacing="-0.01em",
        width=id_box_width,
        flex="0 0 auto",
        min_width="0",
    )

    resume_input = styled_input(
        placeholder="Enter an existing session ID",
        value=PlaygroundState.resume_session_input,
        on_change=PlaygroundState.update_resume_session_input,
        font_family="'Fira Code', 'Monaco', 'Courier New', monospace",
        font_size="13px",
        width=input_width,
        flex="1 1 auto",
        min_width="0",
        max_width=input_width,
    )

    input_container = rx.flex(
        resume_input,
        width="100%",
        justify=rx.breakpoints(initial="start", md="end"),
        align="stretch",
        style={"flex": "1 1 auto"},
    )

    copy_button = styled_button(
        "Copy ID",
        color_scheme="cyan",
        on_click=PlaygroundState.copy_session_id,
        width=button_width,
    )

    resume_button = styled_button(
        "Resume",
        color_scheme="blue",
        on_click=PlaygroundState.resume_session,
        width=button_width,
    )

    new_session_button = styled_button(
        "New Session",
        color_scheme="purple",
        on_click=PlaygroundState.start_new_session,
        width=button_width,
    )

    copy_container = rx.flex(
        copy_button,
        width=copy_container_width,
        justify="start",
        align="stretch",
        wrap="wrap",
        style={"flex": "0 0 auto"},
    )

    actions_container = rx.flex(
        resume_button,
        new_session_button,
        direction=buttons_direction,
        gap="12px",
        width="100%",
        justify=buttons_justify,
        align="stretch",
        wrap="wrap",
        style={"flex": "1 1 auto"},
    )

    buttons_row = rx.flex(
        copy_container,
        actions_container,
        direction=buttons_row_direction,
        gap="12px",
        width="100%",
        align="stretch",
    )

    return card(
        section_header(
            "Session",
            "Every browser session gets its own isolated runtime. Copy the ID to save it or resume one you've stored.",
            icon="shield",
        ),
        rx.vstack(
            rx.flex(
                session_id_display,
                input_container,
                direction=row_direction,
                gap="12px",
                width="100%",
                align="stretch",
                wrap=row_wrap,
            ),
            buttons_row,
            rx.cond(
                PlaygroundState.session_error != "",
                rx.text(
                    PlaygroundState.session_error,
                    color=COLORS["warning"],
                    size="1",
                ),
                rx.fragment(),
            ),
            spacing="3",
            width="100%",
        ),
    )


def styled_button(text: str, color_scheme: str = "blue", **kwargs) -> rx.Component:
    """Styled button with modern appearance."""
    color_map = {
        "purple": COLORS["accent_purple"],
        "blue": COLORS["accent_blue"],
        "cyan": COLORS["accent_cyan"],
        "success": COLORS["success"],
        "warning": COLORS["warning"],
        "error": COLORS["error"],
    }

    bg_color = color_map.get(color_scheme, COLORS["accent_blue"])
    return rx.button(
        text,
        background=bg_color,
        color="white",
        border="none",
        border_radius="8px",
        padding_x="20px",
        padding_y="10px",
        font_weight="500",
        font_size="14px",
        cursor="pointer",
        transition="all 0.2s",
        _hover={
            "opacity": "0.9",
            "transform": "translateY(-1px)",
        },
        **kwargs,
    )


def styled_select(**kwargs) -> rx.Component:
    """Styled select dropdown with dark theme."""
    default_style = {
        "background": COLORS["bg_tertiary"],
        "border": f"1px solid {COLORS['border']}",
        "border_radius": "8px",
        "color": COLORS["text_primary"],
    }
    return rx.select(**{**default_style, **kwargs})


def environment_field_row(info: dict) -> rx.Component:
    key = info.get("key", "")
    label = info.get("label", key)
    tooltip_text = info.get("tooltip", "")
    placeholder = info.get("placeholder", "")

    badge = Badge.create(
        label,
        size="1",
        color_scheme="cyan",
        high_contrast=True,
        radius="medium",
    )

    tooltip = rx.tooltip(
        badge,
        content=tooltip_text,
        delay_duration=200,
    )

    return rx.box(
        rx.hstack(
            tooltip,
            rx.spacer(),
        ),
        styled_input(
            value=PlaygroundState.environment_editor.get(key, ""),
            on_change=lambda value, key=key: PlaygroundState.edit_environment_value(key, value),
            placeholder=placeholder,
        ),
        rx.flex(
            styled_button(
                "Reset",
                on_click=PlaygroundState.reset_environment_value(key),
                color_scheme="error",
            ),
            styled_button(
                "Update",
                on_click=PlaygroundState.apply_environment_value(key),
                color_scheme="cyan",
            ),
            gap="12px",
            align="center",
            justify="end",
            width="100%",
        ),
        display="flex",
        flex_direction="column",
        gap="12px",
        padding="16px",
        background=COLORS["bg_tertiary"],
        border=f"1px solid {COLORS['border_subtle']}",
        border_radius="8px",
    )


CARD_HEIGHT = "400px"
EDITOR_HEIGHT = CARD_HEIGHT
LOAD_VIEW_HEIGHT = CARD_HEIGHT
EXECUTE_HEIGHT = CARD_HEIGHT
STATE_HEIGHT = CARD_HEIGHT


def expert_section() -> rx.Component:
    return card(
        rx.accordion.root(
            rx.accordion.item(
                header=rx.accordion.trigger(
                    rx.box(
                        rx.hstack(
                            rx.icon(
                                tag="settings",
                                size=18,
                                color=COLORS["text_black"],
                            ),
                            rx.heading(
                                "Execution Environment Variables",
                                size="5",
                                color=COLORS["text_black"],
                                font_weight="600",
                            ),
                            rx.spacer(),
                            align_items="center",
                            gap="8px",
                            width="100%",
                        ),
                        rx.text(
                            "Configure deterministic runtime context. Leave a field blank to fall back to live defaults.",
                            color=COLORS["text_black"],
                            size="2",
                            line_height="1.6",
                            width="100%",
                            text_align="left",
                        ),
                        display="flex",
                        flex_direction="column",
                        gap="8px",
                        width="100%",
                    ),
                    padding_y="8px",
                    padding_x="12px",
                ),
                content=rx.accordion.content(
                    rx.box(
                        rx.vstack(
                            rx.text(
                                "Note: The environment variable 'caller' is managed by the runtime during contract-to-contract calls and cannot be overridden here.",
                                color=COLORS["text_secondary"],
                                font_style="italic",
                                size="1",
                                line_height="1.6",
                            ),
                            rx.flex(
                                *[environment_field_row(field) for field in ENVIRONMENT_FIELDS],
                                wrap="wrap",
                                spacing="3",
                                width="100%",
                                align="stretch",
                            ),
                            gap="16px",
                            width="100%",
                        ),
                        background=COLORS["bg_secondary"],
                        border=f"1px solid {COLORS['border']}",
                        border_radius="8px",
                        padding="16px",
                    ),
                    padding_top="12px",
                ),
                value="expert",
            ),
            type="single",
            collapsible=True,
            width="100%",
            default_value="",
            class_name="playground-env-accordion",
        ),
    )


def editor_section(card_kwargs: Dict[str, Any] | None = None) -> rx.Component:
    card_kwargs, is_fullscreen, _ = resolve_panel_context(card_kwargs, EDITOR_HEIGHT)
    editor_height = "100%"

    editor_container_kwargs: Dict[str, Any] = {
        "width": "100%",
        "display": "flex",
        "flex": "1 1 auto",
        "overflow": "hidden",
        "min_height": "0",
        "height": "100%",
    }
    if is_fullscreen:
        editor_container_kwargs.update({"max_height": None})

    lint_results_box = rx.cond(
        PlaygroundState.lint_has_results,
        rx.box(
            rx.vstack(
                rx.hstack(
                    rx.icon(tag="triangle_alert", size=18, color=COLORS["warning"]),
                    rx.heading(
                        "Lint Findings",
                        size="3",
                        color=COLORS["warning"],
                        font_weight="600",
                    ),
                    align_items="center",
                    gap="8px",
                    width="100%",
                ),
                rx.box(
                    rx.vstack(
                        rx.foreach(
                            PlaygroundState.lint_results,
                            lambda message: rx.text(
                                message,
                                color=COLORS["warning"],
                                size="2",
                            ),
                        ),
                        gap="8px",
                        width="100%",
                        align_items="start",
                    ),
                    max_height="160px",
                    overflow_y="auto",
                    width="100%",
                ),
                gap="12px",
                width="100%",
                align_items="stretch",
            ),
            padding="12px",
            border=f"1px solid {COLORS['border']}",
            border_radius="8px",
            background=COLORS["bg_tertiary"],
            width="100%",
        ),
        rx.fragment(),
    )

    return card(
        section_header(
            "Write Contract",
            "Write a Python smart contract, pick a unique `con_` name, and deploy it into the local sandbox.",
            panel_id="write",
            icon="file-pen",
        ),
        panel_stack(
            styled_input(
                placeholder="con_my_contract",
                value=PlaygroundState.contract_name,
                on_change=PlaygroundState.update_contract_name,
                width="100%",
            ),
            rx.flex(
                MonacoEditor.create(
                    default_value=PlaygroundState.code_editor,
                    language="python",
                    theme="vs-dark",
                    height=editor_height,
                    options={
                        "automaticLayout": True,
                        "tabSize": 4,
                        "insertSpaces": True,
                        "scrollBeyondLastLine": False,
                        "wordWrap": "on",
                        "minimap": {"enabled": False},
                        "lineNumbers": "on",
                        "renderWhitespace": "selection",
                        "padding": {"top": 12, "bottom": 12},
                    },
                    on_change=PlaygroundState.update_code,
                    key=PlaygroundState.code_editor_revision,
                    class_name="playground-monaco",
                ),
                **editor_container_kwargs,
            ),
            rx.hstack(
                styled_button(
                    "Save Draft",
                    on_click=PlaygroundState.save_code_draft,
                    color_scheme="blue",
                ),
                rx.spacer(),
                styled_button(
                    "Deploy Contract",
                    on_click=PlaygroundState.deploy_contract,
                    color_scheme="purple",
                ),
                styled_button(
                    rx.cond(
                        PlaygroundState.linting,
                        "Linting...",
                        "Run Linter",
                    ),
                    on_click=PlaygroundState.lint_contract,
                    color_scheme="cyan",
                    disabled=PlaygroundState.linting,
                ),
                width="100%",
                spacing="3",
            ),
            lint_results_box,
            base_height=EDITOR_HEIGHT,
            is_fullscreen=is_fullscreen,
        ),
        **card_kwargs,
    )


def load_section(card_kwargs: Dict[str, Any] | None = None) -> rx.Component:
    card_kwargs, is_fullscreen, _ = resolve_panel_context(card_kwargs, LOAD_VIEW_HEIGHT)

    viewer_stack_style: Dict[str, Any] = {
        "display": "flex",
        "flexDirection": "column",
        "gap": "12px",
        "flex": "1 1 auto",
        "minHeight": "0",
        "width": "100%",
    }

    def _code_viewer_style(is_full: bool) -> Dict[str, Any]:
        style: Dict[str, Any] = {
            "maxWidth": "100%",
            "background": COLORS["bg_tertiary"],
            "border": f"1px solid {COLORS['border']}",
            "borderRadius": "8px",
            "padding": "12px",
            "overflow": "auto",
        }
        if is_full:
            style.update(
                {
                    "height": "100%",
                }
            )
        return style

    contract_visibility_controls = rx.hstack(
        rx.checkbox(
            checked=PlaygroundState.show_system_contracts,
            on_change=PlaygroundState.set_show_system_contracts,
            color_scheme="cyan",
        ),
        rx.text(
            "Show system contracts",
            color=COLORS["text_primary"],
            size="2",
            cursor="pointer",
            on_click=PlaygroundState.toggle_show_system_contracts,
        ),
        rx.spacer(),
        rx.cond(
            PlaygroundState.hidden_system_contract_count > 0,
            rx.text(
                "System contracts hidden by default",
                color=COLORS["text_muted"],
                size="1",
            ),
            rx.fragment(),
        ),
        align_items="center",
        width="100%",
        flex_wrap="wrap",
        gap="8px",
    )

    load_panel = panel_stack(
        contract_visibility_controls,
        styled_select(
            items=PlaygroundState.deployed_contracts,
            value=PlaygroundState.load_selected_contract,
            placeholder="Select a contract",
            on_change=PlaygroundState.change_loaded_contract,
            disabled=PlaygroundState.deployed_contracts == [],
            width="100%",
        ),
        rx.cond(
            PlaygroundState.load_selected_contract == "",
            rx.box(
                rx.text(
                    rx.cond(
                        PlaygroundState.hidden_system_contract_count > 0,
                        "No user contracts to inspect yet. Turn on 'Show system contracts' to inspect seeded runtime contracts.",
                        "Select a deployed contract to review its source and exports.",
                    ),
                    color=COLORS["text_muted"],
                    size="2",
                ),
                padding="12px",
                border=f"1px dashed {COLORS['border']}",
                border_radius="8px",
            ),
            rx.box(
                rx.hstack(
                    rx.text(
                        rx.cond(
                            PlaygroundState.load_view_local_runtime,
                            "Local runtime",
                            "Source",
                        ),
                        color=COLORS["text_secondary"],
                        size="2",
                    ),
                    rx.spacer(),
                    rx.switch(
                        checked=PlaygroundState.load_view_local_runtime,
                        on_change=lambda value: PlaygroundState.toggle_load_view(),
                        color_scheme="cyan",
                    ),
                    spacing="3",
                    align_items="center",
                    width="100%",
                    flex_wrap="wrap",
                ),
                rx.box(
                    rx.cond(
                        PlaygroundState.load_view_local_runtime,
                        code_viewer(
                            PlaygroundState.loaded_contract_runtime_source,
                            "python",
                            "# Local runtime source unavailable.",
                            font_size="12px",
                            boxed=False,
                            style=_code_viewer_style(is_fullscreen),
                        ),
                        code_viewer(
                            PlaygroundState.loaded_contract_source,
                            "python",
                            "# Source unavailable.",
                            font_size="12px",
                            boxed=False,
                            style=_code_viewer_style(is_fullscreen),
                        ),
                    ),
                    flex="1 1 auto",
                    min_height="0",
                    width="100%",
                    display="flex",
                    flex_direction="column",
                ),
                styled_button(
                    "Remove Contract",
                    on_click=PlaygroundState.remove_selected_contract,
                    color_scheme="error",
                    disabled=PlaygroundState.load_selected_contract == "",
                    width="100%",
                    margin_top="auto",
                ),
                **viewer_stack_style,
            ),
        ),
        base_height=LOAD_VIEW_HEIGHT,
        is_fullscreen=is_fullscreen,
    )

    return card(
        section_header(
            "Load Contract",
            "Inspect deployed contract source code.",
            panel_id="load",
            icon="folder-open",
        ),
        load_panel,
        **card_kwargs,
    )



def execution_section(card_kwargs: Dict[str, Any] | None = None) -> rx.Component:
    card_kwargs, is_fullscreen, _ = resolve_panel_context(card_kwargs, EXECUTE_HEIGHT)

    contract_visibility_controls = rx.hstack(
        rx.checkbox(
            checked=PlaygroundState.show_system_contracts,
            on_change=PlaygroundState.set_show_system_contracts,
            color_scheme="cyan",
        ),
        rx.text(
            "Show system contracts",
            color=COLORS["text_primary"],
            size="2",
            cursor="pointer",
            on_click=PlaygroundState.toggle_show_system_contracts,
        ),
        rx.spacer(),
        rx.cond(
            PlaygroundState.hidden_system_contract_count > 0,
            rx.text(
                "System contracts hidden by default",
                color=COLORS["text_muted"],
                size="1",
            ),
            rx.fragment(),
        ),
        align_items="center",
        width="100%",
        flex_wrap="wrap",
        gap="8px",
    )

    textarea_kwargs: Dict[str, Any] = {
        "placeholder": 'Kwargs as JSON, e.g. {"to": "alice", "amount": 25}',
        "value": PlaygroundState.kwargs_input,
        "on_change": PlaygroundState.update_kwargs,
        "font_family": "'Fira Code', 'Monaco', 'Courier New', monospace",
        "class_name": "playground-kwargs-textarea",
        "spell_check": False,
        "min_height": "120px",
        "height": "100%",
    }
    textarea_container_props: Dict[str, Any] = {
        "width": "100%",
        "flex": "1 1 auto",
        "min_height": "120px",
        "overflow": "hidden",
        "display": "flex",
        "flex_direction": "column",
    }

    result_view = rx.cond(
        PlaygroundState.run_result == "",
        rx.fragment(),
        rx.vstack(
            rx.hstack(
                rx.icon(tag="terminal", size=18, color=COLORS["accent_cyan"]),
                rx.heading(
                    "Result",
                    size="3",
                    color=COLORS["text_primary"],
                    font_weight="600",
                ),
                align_items="center",
                gap="8px",
                width="100%",
            ),
            code_viewer(
                PlaygroundState.run_result,
                "json",
                "Awaiting execution...",
                font_size="12px",
                boxed=False,
                style={
                    "width": "100%",
                    "fontSize": "12px",
                    "maxHeight": "50vh" if is_fullscreen else "300px",
                    "overflow": "auto",
                    "border": f"1px solid {COLORS['border']}",
                    "borderRadius": "8px",
                    "padding": "12px",
                    "background": COLORS["bg_tertiary"],
                },
            ),
            spacing="3",
            width="100%",
        ),
    )

    return card(
        section_header(
            "Execute Contract",
            "Pick a deployed contract and exported function to run.",
            panel_id="execute",
            icon="play",
        ),
        panel_stack(
            contract_visibility_controls,
            styled_select(
                items=PlaygroundState.deployed_contracts,
                value=PlaygroundState.selected_contract,
                placeholder="Select a contract",
                on_change=PlaygroundState.change_selected_contract,
                disabled=PlaygroundState.deployed_contracts == [],
                width="100%",
            ),
            styled_select(
                items=PlaygroundState.available_functions,
                value=PlaygroundState.function_name,
                placeholder="Select a function",
                on_change=PlaygroundState.change_selected_function,
                disabled=PlaygroundState.available_functions == [],
                width="100%",
            ),
            rx.cond(
                PlaygroundState.selected_contract == "",
                rx.box(
                    rx.text(
                        rx.cond(
                            PlaygroundState.hidden_system_contract_count > 0,
                            "No user contracts available to execute. Turn on 'Show system contracts' to expose seeded runtime contracts.",
                            "Deploy a contract to execute one of its exported functions.",
                        ),
                        color=COLORS["text_muted"],
                        size="2",
                    ),
                    padding="12px",
                    border=f"1px dashed {COLORS['border']}",
                    border_radius="8px",
                ),
                rx.fragment(),
            ),
            rx.box(
                styled_text_area(**textarea_kwargs),
                **textarea_container_props,
            ),
            rx.box(
                styled_button(
                    "Run Function",
                    on_click=PlaygroundState.run_contract,
                    color_scheme="success",
                    disabled=PlaygroundState.function_name == "",
                    width="100%",
                ),
                width="100%",
            ),
            result_view,
            base_height=EXECUTE_HEIGHT,
            is_fullscreen=is_fullscreen,
            spacing="4",
        ),
        **card_kwargs,
    )


def log_section() -> rx.Component:
    body_height = "360px"

    clear_button_row = rx.cond(
        PlaygroundState.log_entries == [],
        rx.fragment(),
        rx.hstack(
            rx.spacer(),
            styled_button(
                "Clear Log",
                color_scheme="warning",
                on_click=PlaygroundState.clear_logs,
            ),
            width="100%",
            align_items="center",
        ),
    )

    log_entries_content = rx.cond(
        PlaygroundState.log_entries == [],
        rx.text(
            "Actions you run will appear here with the latest at the bottom.",
            color=COLORS["text_secondary"],
            size="2",
        ),
        rx.box(
            rx.vstack(
                rx.foreach(
                    PlaygroundState.log_entries,
                    lambda entry, idx: log_entry_item(entry),
                ),
                gap="12px",
                width="100%",
            ),
            max_height=body_height,
            overflow="auto",
            width="100%",
            background=COLORS["bg_tertiary"],
            border=f"1px solid {COLORS['border']}",
            border_radius="12px",
            padding="12px",
        ),
    )

    log_body = rx.box(
        rx.vstack(
            log_entries_content,
            clear_button_row,
            spacing="3",
            width="100%",
        ),
        width="100%",
    )

    header = rx.hstack(
        rx.hstack(
            rx.icon(tag="list", size=18, color=COLORS["text_black"]),
            rx.heading(
                "Activity Log",
                size="5",
                color=COLORS["text_black"],
                font_weight="600",
            ),
            align_items="center",
            gap="8px",
        ),
        rx.spacer(),
        align_items="center",
        gap="8px",
        width="100%",
    )

    description = rx.text(
        "Recent deployments, executions, and state mutations.",
        color=COLORS["text_black"],
        size="2",
        line_height="1.6",
        width="100%",
        text_align="left",
    )

    return card(
        rx.accordion.root(
            rx.accordion.item(
                header=rx.accordion.trigger(
                    rx.box(
                        header,
                        description,
                        display="flex",
                        flex_direction="column",
                        gap="8px",
                        width="100%",
                    ),
                    padding_y="8px",
                    padding_x="12px",
                ),
                content=rx.accordion.content(log_body, padding_top="12px"),
                value="activity-log",
            ),
            type="single",
            collapsible=True,
            default_value="",
            width="100%",
            key=PlaygroundState.activity_log_view_key,
        ),
    )


def state_section(card_kwargs: Dict[str, Any] | None = None) -> rx.Component:
    card_kwargs, is_fullscreen, _ = resolve_panel_context(card_kwargs, STATE_HEIGHT)

    inner_panel_style: Dict[str, Any] = {
        "flex": "1 1 auto",
        "width": "100%",
        "overflow": "auto",
        "minHeight": "0",
        "background": COLORS["bg_tertiary"],
        "border": f"1px solid {COLORS['border']}",
        "borderRadius": "8px",
        "padding": "12px",
    }

    viewer_style: Dict[str, Any] = {
        **inner_panel_style,
        "width": "100%",
        "flex": "1 1 auto",
        "minHeight": "0",
    }
    if is_fullscreen:
        viewer_style["height"] = "100%"

    viewer_content = rx.cond(
        PlaygroundState.state_is_editing,
        styled_text_area(
            value=PlaygroundState.state_editor,
            on_change=PlaygroundState.update_state_editor,
            font_family="'Fira Code', 'Monaco', 'Courier New', monospace",
            overflow_y="auto",
            spell_check=False,
            height="100%" if is_fullscreen else "auto",
            style=viewer_style,
        ),
        code_viewer(
            PlaygroundState.state_dump,
            "json",
            "State is empty.",
            font_size="12px",
            boxed=False,
            style=viewer_style,
        ),
    )

    state_panel = panel_stack(
        rx.hstack(
            rx.checkbox(
                checked=PlaygroundState.show_internal_state,
                on_change=PlaygroundState.set_show_internal_state,
                color_scheme="cyan",
            ),
            rx.text(
                "Show protected state keys",
                color=COLORS["text_primary"],
                size="2",
                cursor="pointer",
                on_click=PlaygroundState.toggle_show_internal_state,
            ),
            rx.spacer(),
            rx.cond(
                PlaygroundState.state_is_editing,
                rx.hstack(
                    styled_button(
                        "Save Changes",
                        color_scheme="success",
                        on_click=PlaygroundState.toggle_state_editor,
                    ),
                    styled_button(
                        "Cancel",
                        color_scheme="error",
                        on_click=PlaygroundState.cancel_state_editing,
                    ),
                    spacing="3",
                    align="center",
                    justify="end",
                ),
                styled_button(
                    "Edit State",
                    color_scheme="cyan",
                    on_click=PlaygroundState.toggle_state_editor,
                ),
            ),
            align_items="center",
            spacing="3",
            width="100%",
            flex_wrap="wrap",
        ),
        viewer_content,
        rx.hstack(
            rx.alert_dialog.root(
                rx.alert_dialog.trigger(
                    styled_button(
                        "Clear All State",
                        color_scheme="error",
                    ),
                ),
                rx.alert_dialog.content(
                    rx.vstack(
                        rx.alert_dialog.title(
                            "Clear all contracts and runtime state?",
                        ),
                        rx.alert_dialog.description(
                            "This wipes every deployed contract (except the system submission contract) and resets the driver. This cannot be undone.",
                        ),
                        rx.hstack(
                            rx.alert_dialog.cancel(
                                styled_button(
                                    "Cancel",
                                    color_scheme="blue",
                                ),
                            ),
                            rx.alert_dialog.action(
                                styled_button(
                                    "Confirm Clear",
                                    color_scheme="error",
                                    on_click=PlaygroundState.confirm_clear_state,
                                ),
                            ),
                            spacing="3",
                            justify="end",
                            width="100%",
                        ),
                        spacing="4",
                        align_items="stretch",
                    ),
                    max_width="420px",
                    background=COLORS["bg_secondary"],
                    border=f"1px solid {COLORS['border']}",
                    border_radius="12px",
                    padding="24px",
                ),
            ),
            rx.spacer(),
            styled_button(
                "Export State",
                on_click=PlaygroundState.export_state,
                color_scheme="cyan",
            ),
            rx.upload(
                styled_button(
                    "Import State",
                    color_scheme="purple",
                ),
                accept={"application/json": [".json"]},
                multiple=False,
                max_files=1,
                on_drop=PlaygroundState.import_state,
                no_drag=True,
                style={
                    "display": "inline-flex",
                    "border": "none",
                    "padding": "0",
                    "background": "transparent",
                },
                class_name="playground-upload",
            ),
            spacing="3",
            align_items="center",
            width="100%",
        ),
        spacing="3",
        base_height=STATE_HEIGHT,
        is_fullscreen=is_fullscreen,
    )

    return card(
        section_header(
            "Contract State",
            "Live snapshot of every key stored in the driver. Refreshes after deployments and executions.",
            panel_id="state",
            icon="database",
        ),
        state_panel,
        **card_kwargs,
    )


def fullscreen_overlay() -> rx.Component:
    fullscreen_card_props = {
        "height": "100%",
        "min_height": "0",
        "flex": "1 1 auto",
        "display": "flex",
        "flex_direction": "column",
        "class_name": "fullscreen-card",
    }

    def _render_overlay(content: rx.Component) -> rx.Component:
        return rx.fragment(
            rx.window_event_listener(
                on_key_down=PlaygroundState.handle_fullscreen_keydown
            ),
            rx.box(
                content,
                position="fixed",
                inset="0",
                padding=["16px", "24px", "32px"],
                background=COLORS["bg_primary"],
                min_height="100vh",
                height="100vh",
                display="flex",
                flex_direction="column",
                align_items="stretch",
                overflow_y="auto",
                z_index="1000",
            ),
        )

    return rx.cond(
        PlaygroundState.expanded_panel == "write",
        _render_overlay(editor_section(card_kwargs=fullscreen_card_props)),
        rx.cond(
            PlaygroundState.expanded_panel == "load",
            _render_overlay(load_section(card_kwargs=fullscreen_card_props)),
            rx.cond(
                PlaygroundState.expanded_panel == "execute",
                _render_overlay(execution_section(card_kwargs=fullscreen_card_props)),
                rx.cond(
                    PlaygroundState.expanded_panel == "state",
                    _render_overlay(state_section(card_kwargs=fullscreen_card_props)),
                    rx.fragment(),
                ),
            ),
        ),
    )


def loading_overlay() -> rx.Component:
    spinner_style = """
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0% { opacity: 0.9; transform: translateY(0px); }
  50% { opacity: 0.6; transform: translateY(-4px); }
  100% { opacity: 0.9; transform: translateY(0px); }
}
"""

    return rx.cond(
        PlaygroundState.bootstrapping,
        rx.fragment(
            rx.el.style(spinner_style),
            rx.box(
                rx.vstack(
                    rx.box(
                        rx.icon(
                            tag="loader",
                            size=28,
                            color=COLORS["accent_cyan"],
                            style={"animation": "spin 1s linear infinite"},
                        ),
                        width="56px",
                        height="56px",
                        border=f"1px solid {COLORS['border']}",
                        border_radius="50%",
                        display="grid",
                        place_items="center",
                        background=COLORS["bg_secondary"],
                        box_shadow="0 10px 30px rgba(0, 0, 0, 0.35)",
                    ),
                    rx.heading(
                        "Preparing your session",
                        size="5",
                        color=COLORS["text_primary"],
                    ),
                    rx.text(
                        "Restoring contracts, state, and environment before the workspace becomes interactive.",
                        color=COLORS["text_secondary"],
                        size="2",
                        text_align="center",
                        style={"animation": "pulse 1.8s ease-in-out infinite"},
                        max_width="30rem",
                    ),
                    spacing="4",
                    align_items="center",
                ),
                position="fixed",
                inset="0",
                z_index="1200",
                display="flex",
                align_items="center",
                justify_content="center",
                padding="24px",
                background="rgba(10, 10, 11, 0.92)",
                backdrop_filter="blur(6px)",
            ),
        ),
        rx.fragment(),
    )


def not_found_page() -> rx.Component:
    message = (
        "The page you’re looking for doesn’t exist or has been moved. "
        "Head back to the main playground or spin up a fresh session."
    )
    session_script = f"""
(function() {{
    const backendBase = {json.dumps((get_config().api_url or "").rstrip("/"))};
    const path = "/sessions/new";
    const origin = window.location.origin || "";
    const nextParam = encodeURIComponent(origin + "/");
    const target = (backendBase ? backendBase : "") + path + "?next=" + nextParam;
    window.location.assign(target);
}})();
"""
    return rx.box(
        rx.box(
            rx.vstack(
                rx.image(
                    src="/favicon.png",
                    alt="Xian Playground logo",
                    width="84px",
                    height="84px",
                ),
                rx.heading(
                    "404 – Page Not Found",
                    size="7",
                    color=COLORS["text_primary"],
                ),
                rx.text(
                    message,
                    color=COLORS["text_secondary"],
                    text_align="center",
                    line_height="1.7",
                ),
                rx.hstack(
                    styled_button(
                        "Return to Playground",
                        color_scheme="cyan",
                        on_click=rx.redirect("/"),
                    ),
                    styled_button(
                        "Start New Session",
                        color_scheme="purple",
                        on_click=rx.call_script(session_script),
                    ),
                    spacing="3",
                    justify="center",
                    wrap="wrap",
                    width="100%",
                ),
                spacing="4",
                align_items="center",
                width="100%",
            ),
            width="100%",
            max_width="520px",
            background=COLORS["bg_secondary"],
            padding="40px",
            border_radius="20px",
            border=f"1px solid {COLORS['border']}",
            box_shadow="0 35px 80px rgba(0, 0, 0, 0.55)",
            gap="6",
        ),
        min_height="100vh",
        width="100%",
        background=COLORS["bg_primary"],
        display="flex",
        align_items="center",
        justify_content="center",
        padding="32px",
    )


def header() -> rx.Component:
    """Modern header with gradient accent."""
    return rx.box(
        rx.vstack(
            rx.hstack(
                rx.box(
                    rx.heading(
                        "Xian",
                        size="8",
                        color=COLORS["text_primary"],
                        font_weight="700",
                        letter_spacing="-0.02em",
                    ),
                    rx.heading(
                        "Contracting Playground",
                        size="8",
                        background=f"linear-gradient(135deg, {COLORS['accent_purple']} 0%, {COLORS['accent_cyan']} 100%)",
                        background_clip="text",
                        color="transparent",
                        font_weight="700",
                        letter_spacing="-0.02em",
                    ),
                    gap="8px",
                    display="flex",
                    flex_direction="row",
                    align_items="baseline",
                    flex_wrap="wrap",
                ),
                align_items="baseline",
        ),
        rx.text(
            "Deploy Python smart contracts, execute exported functions, and inspect resulting state without leaving the browser.",
            color=COLORS["text_secondary"],
            size="3",
            line_height="1.6",
        ),
            gap="12px",
            align_items="start",
            width="100%",
        ),
        padding_y="32px",
        width="100%",
    )


def _maybe_render_panel(panel_id: str, component: rx.Component) -> rx.Component:
    """Hide the base panel when its fullscreen variant is active."""
    return rx.cond(
        PlaygroundState.expanded_panel == panel_id,
        rx.fragment(),
        component,
    )


def index() -> rx.Component:
    return rx.box(
        rx.vstack(
            rx.box(
                header(),
                width="100%",
                max_width="1400px",
                margin_x="auto",
                padding_x=["16px", "24px", "32px"],
            ),
            rx.box(
                rx.vstack(
                    session_panel(),
                    # Main content grid - Editor and Execution side by side
                    rx.box(
                        rx.grid(
                            _maybe_render_panel("write", editor_section()),
                            _maybe_render_panel("load", load_section()),
                            _maybe_render_panel("execute", execution_section()),
                            _maybe_render_panel("state", state_section()),
                            columns="2",
                            spacing="5",
                            width="100%",
                        ),
                        width="100%",
                        display=["none", "none", "block"],  # Hide on mobile
                    ),
                    # Mobile stack layout
                    rx.box(
                        rx.vstack(
                            _maybe_render_panel("write", editor_section()),
                            _maybe_render_panel("load", load_section()),
                            _maybe_render_panel("execute", execution_section()),
                            _maybe_render_panel("state", state_section()),
                            spacing="5",
                            width="100%",
                        ),
                        width="100%",
                        display=["block", "block", "none"],  # Show on mobile
                    ),
                    # Full width expert + log sections
                    expert_section(),
                    log_section(),
                    spacing="5",
                    width="100%",
                ),
                width="100%",
                max_width="1400px",
                margin_x="auto",
                padding_x=["16px", "24px", "32px"],
                padding_bottom="64px",
            ),
            spacing="0",
            width="100%",
        ),
        loading_overlay(),
        fullscreen_overlay(),
        background=COLORS["bg_primary"],
        min_height="100vh",
        width="100%",
    )


app = rx.App(
    theme=rx.theme(
        appearance="dark",
        accent_color="cyan",
        gray_color="slate",
        radius="large",
        scaling="100%",
    ),
    stylesheets=[
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
        "https://unpkg.com/@radix-ui/themes@3.2.1/styles.css",
        "/editor.css",
    ],
)

app.add_page(
    index,
    title="Xian Contracting Playground",
    on_load=PlaygroundState.on_load,
)

app.add_page(
    not_found_page,
    route="404",
    title="Page Not Found",
)

app._api.add_middleware(SessionCookieMiddleware)

# Serve playground favicon across every page.
app.head_components.append(
    rx.el.link(rel="icon", type="image/png", href="/favicon.png")
)


def _frontend_redirect_target(request: Request) -> str:
    next_param = request.query_params.get("next")
    if next_param:
        return unquote(next_param)
    referer = request.headers.get("referer")
    if referer:
        return referer
    deploy = get_config().deploy_url
    if deploy:
        return deploy
    return "/"


async def create_session_route(request: Request):
    metadata = session_runtime.create_session()
    response = RedirectResponse(_frontend_redirect_target(request))
    issue_session_cookie(response, metadata.session_id, request=request)
    return response


async def resume_session_route(request: Request):
    raw = request.path_params.get("session_id", "").lower()
    if not SessionRepository.is_valid_session_id(raw):
        return RedirectResponse("/sessions/new")
    if not session_runtime.session_exists(raw):
        return RedirectResponse("/sessions/new")
    metadata = session_runtime.ensure_exists(raw)
    response = RedirectResponse(_frontend_redirect_target(request))
    issue_session_cookie(response, metadata.session_id, request=request)
    return response


app._api.add_route("/sessions/new", create_session_route, methods=["GET"])
app._api.add_route("/sessions/{session_id}", resume_session_route, methods=["GET"])
