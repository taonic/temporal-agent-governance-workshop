"""Describe harness tools to an OpenAI-compatible model."""

import inspect
from collections.abc import Callable
from typing import Any

from pydantic import create_model


def openai_tool(fn: Callable[..., Any]) -> dict[str, Any]:
    """The OpenAI ``tools=`` entry for a harness tool.

    The harness tool decorators give the returned object a model-facing signature (injected
    parameters already removed) and docstring; the Code Mode tool's docstring is generated and
    lists every host function the script can call. So the schema is read straight off it.
    """
    fields: dict[str, Any] = {}
    for name, param in inspect.signature(fn).parameters.items():
        default = ... if param.default is inspect.Parameter.empty else param.default
        fields[name] = (param.annotation, default)
    schema = create_model(f"{fn.__name__}_arguments", **fields).model_json_schema()
    schema.pop("title", None)
    for prop in schema.get("properties", {}).values():
        prop.pop("title", None)
    return {
        "type": "function",
        "function": {
            "name": fn.__name__,
            "description": inspect.cleandoc(fn.__doc__ or ""),
            "parameters": schema,
        },
    }
