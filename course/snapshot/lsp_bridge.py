"""The editor's language server, over a WebSocket.

Each connection gets its own jedi-language-server on stdio, so two browser tabs don't share
(and confuse) one server's state, and closing a tab ends its server. Messages go across as
WebSocket text frames, one JSON-RPC message each, which is what @codemirror/lsp-client sends;
the server side gets the usual Content-Length framing.

One request the bridge answers itself: course/paramDoc, what a keyword argument means. jedi's
hover on `start_to_close_timeout=` only gives its type; the explanation is in the library's
docstrings, in the function's "Args:" section (or the one its docstring points to, as
execute_activity's points to start_activity), or under a dataclass field (RetryPolicy's).

Runs from /opt/lsp (see the snapshot's Dockerfile), started by the course runner:

    /opt/lsp/bin/python /opt/lsp/lsp_bridge.py --port 2087
"""

import argparse
import asyncio
import json
import os
import re
import sys

import jedi
from websockets.asyncio.server import serve

SERVER = os.path.join(os.path.dirname(sys.executable), "jedi-language-server")


async def messages(stdout):
    while True:
        length = None
        while True:
            line = await stdout.readline()
            if not line:
                return
            line = line.strip()
            if not line:
                break
            name, _, value = line.decode("ascii").partition(":")
            if name.strip().lower() == "content-length":
                length = int(value)
        if length is not None:
            yield await stdout.readexactly(length)


# --- course/paramDoc ---------------------------------------------------------------------------


def rst_to_markdown(text):
    text = re.sub(r":py:\w+:`~?([\w.]+)`", lambda m: f"`{m.group(1).split('.')[-1]}`", text)
    return text.replace("``", "`")


def args_entry(docstring, name):
    """The description of `name` in a Google-style docstring's Args section, or None."""
    lines = (docstring or "").splitlines()
    for i, line in enumerate(lines):
        if line.strip() not in ("Args:", "Arguments:", "Parameters:"):
            continue
        header = len(line) - len(line.lstrip())
        entry = None
        for body in lines[i + 1 :]:
            indent = len(body) - len(body.lstrip())
            if body.strip() and indent <= header:
                break
            match = re.match(r"\s*\*{0,2}(\w+)\s*(?:\([^)]*\))?:\s*(.*)", body)
            if match and (entry is None or indent <= entry[0]):
                if entry and entry[1] == name:
                    break
                entry = (indent, match.group(1), [match.group(2)])
            elif entry and body.strip():
                entry[2].append(body.strip())
        if entry and entry[1] == name:
            return " ".join(entry[2]).strip()
    return None


def field_docstring(path, line):
    """The string literal just under a class attribute (line is 1-based), as dataclasses use."""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    rest = "\n".join(lines[line:]).lstrip()
    match = re.match(r'(?:"""|\'\'\')(.*?)(?:"""|\'\'\')', rest, re.S)
    return " ".join(match.group(1).split()) if match else None


def param_doc(root, project, params):
    text, path = params["text"], params["path"]
    line, column = params["line"] + 1, params["character"]
    script = jedi.Script(text, path=os.path.join(root, path), project=project)
    param = next((n for n in script.goto(line, column) if n.type == "param"), None)
    if not param or not param.module_path:
        return None
    owner = param.parent()
    doc, source = None, owner.name
    if owner.type == "class":
        doc = field_docstring(str(param.module_path), param.line)
    if not doc:
        docstring = owner.docstring(raw=True)
        doc = args_entry(docstring, param.name)
        # "This is a shortcut for :py:meth:`start_activity`": the args are documented there.
        if not doc and param.module_path:
            module = jedi.Script(path=str(param.module_path), project=project)
            for target in re.findall(r":py:(?:meth|func):`~?([\w.]+)`", docstring):
                short = target.split(".")[-1]
                for name in module.get_names(all_scopes=True):
                    if name.name == short and name.type == "function":
                        doc = args_entry(name.docstring(raw=True), param.name)
                        if doc:
                            source = short
                            break
                if doc:
                    break
    return {"name": param.name, "owner": owner.name, "source": source, "doc": rst_to_markdown(doc) if doc else None}


async def answer(ws, root, project, message):
    try:
        result = await asyncio.to_thread(param_doc, root, project, message.get("params") or {})
        reply = {"jsonrpc": "2.0", "id": message["id"], "result": result}
    except Exception as err:  # a lookup that fails is just a hover without docs
        reply = {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32603, "message": str(err)}}
    await ws.send(json.dumps(reply))


# --- The connection ------------------------------------------------------------------------------


async def session(ws, root, project):
    # VIRTUAL_ENV points jedi at the workshop's venv, so temporalio and the workshop's own
    # packages resolve (jedi-language-server itself lives in /opt/lsp).
    proc = await asyncio.create_subprocess_exec(
        SERVER,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        cwd=root,
        env={**os.environ, "VIRTUAL_ENV": f"{root}/.venv"},
    )

    async def to_client():
        async for body in messages(proc.stdout):
            await ws.send(body.decode("utf-8"))

    async def to_server():
        async for message in ws:
            if '"course/paramDoc"' in message:
                request = json.loads(message)
                if request.get("method") == "course/paramDoc":
                    asyncio.create_task(answer(ws, root, project, request))
                    continue
            data = message.encode("utf-8") if isinstance(message, str) else message
            proc.stdin.write(b"Content-Length: %d\r\n\r\n" % len(data) + data)
            await proc.stdin.drain()

    tasks = [asyncio.create_task(to_client()), asyncio.create_task(to_server())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        if proc.returncode is None:
            proc.kill()
        await proc.wait()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=2087)
    parser.add_argument("--root", default="/workshop")
    args = parser.parse_args()
    project = jedi.Project(args.root, environment_path=os.path.join(args.root, ".venv", "bin", "python"))
    async with serve(lambda ws: session(ws, args.root, project), args.host, args.port, max_size=8 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
