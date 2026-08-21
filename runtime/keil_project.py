"""Keil MDK 工程扫描与 Target 枚举"""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


DEFAULT_MAX_RESULTS = 50
DEFAULT_MAX_DEPTH = 8


def error_result(action: str, code: str, message: str, details: dict | None = None) -> dict:
    result = {"status": "error", "action": action, "error": {"code": code, "message": message}}
    if details:
        result["details"] = details
    return result


def is_broad_root(root_path: Path) -> bool:
    resolved = root_path.resolve()
    home = Path.home().resolve()
    if resolved == home:
        return True
    if resolved.parent == resolved:
        return True
    if resolved == Path(resolved.anchor):
        return True
    anchor = Path(resolved.anchor)
    broad_roots = [
        anchor / "Users",
        anchor / "Windows",
        anchor / "Program Files",
        anchor / "Program Files (x86)",
    ]
    return any(resolved == item.resolve() for item in broad_roots if item.exists())


def _depth(base: Path, path: Path) -> int:
    try:
        return len(path.relative_to(base).parts)
    except ValueError:
        return 0


def scan_projects(root: str, max_results: int = DEFAULT_MAX_RESULTS, max_depth: int = DEFAULT_MAX_DEPTH) -> tuple[list[dict], dict | None]:
    """递归搜索 .uvprojx 文件，默认限制在工作区范围内。"""
    root_path = Path(root).resolve()
    if not root_path.exists() or not root_path.is_dir():
        return [], error_result("scan", "root_not_found", f"扫描根目录不存在或不是目录: {root_path}")
    if is_broad_root(root_path):
        return [], error_result(
            "scan",
            "scan_scope_too_broad",
            f"拒绝扫描过大目录: {root_path}",
            {"root": str(root_path), "next_actions": ["请把 --root 指向具体项目目录或 workspace，不要扫描盘根、用户主目录或系统目录。"]},
        )

    projects = []
    for current, dirs, files in __import__("os").walk(root_path):
        current_path = Path(current)
        depth = _depth(root_path, current_path)
        if depth >= max_depth:
            dirs[:] = []
        skip_dirs = {".git", ".svn", ".hg", "node_modules", ".venv", "venv", "__pycache__"}
        dirs[:] = [item for item in dirs if item not in skip_dirs]
        for filename in files:
            p = current_path / filename
            if p.suffix.lower() != ".uvprojx":
                continue
            projects.append({
                "path": str(p),
                "name": p.stem,
                "type": "project",
            })
            if len(projects) > max_results:
                projects.sort(key=lambda x: x["path"])
                return projects[:max_results], error_result(
                    "scan",
                    "too_many_projects",
                    f"发现超过 {max_results} 个 Keil 工程，请缩小扫描目录。",
                    {"root": str(root_path), "count_at_least": len(projects), "max_results": max_results, "projects": projects[:max_results]},
                )
    projects.sort(key=lambda x: x["path"])
    return projects, None


def list_targets(project_path: str) -> list[dict]:
    """解析 .uvprojx 中的 TargetName"""
    p = Path(project_path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"工程文件不存在: {p}")
    if p.suffix.lower() != ".uvprojx":
        raise ValueError(f"仅支持 .uvprojx 文件，当前: {p.suffix}")

    tree = ET.parse(str(p))
    root = tree.getroot()
    targets = []
    for target_el in root.iter("Target"):
        name_el = target_el.find("TargetName")
        if name_el is not None and name_el.text:
            targets.append({"name": name_el.text.strip()})
    return targets


MAX_MAP_FILES = 500
MAX_MAP_INCLUDES = 80
MAX_MAP_DEFINES = 80
MAX_MAP_EDGES = 400
MAX_FUNCS_FILE = 80
MAX_FUNCS_TOTAL = 1200
MAX_SOURCE_BYTES = 262144
INCLUDE_RE = re.compile(r'^[ \t]*#[ \t]*include[ \t]+[<"]([^>"]+)[>"]', re.M)
FUNC_PROTO = re.compile(
    r'^[ \t]*(?:(?:static|inline|extern|__inline|__forceinline)\s+)*'
    r'[\w\*][\w\s\*]+\s+(\w+)\s*\([^;{}]{0,240}\)\s*(\{)?\s*$'
)
FUNC_SKIP = {
    "if", "for", "while", "switch", "return", "sizeof", "typeof", "catch", "else",
    "do", "case", "default", "defined",
}

FILE_KIND = {
    ".c": "c",
    ".cpp": "c",
    ".cc": "c",
    ".h": "h",
    ".hpp": "h",
    ".s": "asm",
    ".asm": "asm",
    ".lib": "lib",
    ".a": "lib",
    ".o": "obj",
    ".obj": "obj",
}


def _kind_of(name: str) -> str:
    ext = Path(name).suffix.lower()
    return FILE_KIND.get(ext, "other")


def _split_inc(text: str) -> list[str]:
    out = []
    for part in (text or "").split(";"):
        item = part.strip()
        if item:
            out.append(item)
    return out


def _split_def(text: str) -> list[str]:
    out = []
    for part in (text or "").replace(";", ",").split(","):
        item = part.strip()
        if item:
            out.append(item)
    return out[:MAX_MAP_DEFINES]


def _looks_binary(data: bytes) -> bool:
    if not data:
        return False
    if b"\x00" in data:
        return True
    textish = sum(1 for b in data if 32 <= b < 127 or b in (9, 10, 13))
    return textish / max(len(data), 1) < 0.75


def _readable(path: Path) -> tuple[bool, str]:
    if not path.is_file():
        return False, "missing"
    try:
        data = path.read_bytes()[:2048]
    except OSError:
        return False, "unreadable"
    if _looks_binary(data):
        return False, "binary"
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            data.decode(enc)
            return True, "ok"
        except UnicodeDecodeError:
            continue
    return False, "binary"


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def _read_source(path: Path) -> str:
    try:
        raw = path.read_bytes()[:MAX_SOURCE_BYTES]
    except OSError:
        return ""
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


def _functions(text: str) -> list[dict]:
    lines = text.splitlines()
    out = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or re.search(r"\b(typedef|struct|enum|union)\b", line):
            continue
        match = FUNC_PROTO.match(line)
        if not match:
            continue
        name = match.group(1)
        if name in FUNC_SKIP:
            continue
        if not match.group(2):
            nxt = next((item.strip() for item in lines[i + 1:i + 3] if item.strip()), "")
            if nxt != "{":
                continue
        out.append({"name": name, "line": i + 1})
        if len(out) >= MAX_FUNCS_FILE:
            break
    return out


def _includes_of(text: str) -> list[str]:
    seen = []
    for match in INCLUDE_RE.finditer(text):
        name = match.group(1).strip().replace("\\", "/")
        if name and name not in seen:
            seen.append(name)
    return seen[:40]


def _resolve_include(name: str, from_file: Path, inc_dirs: list[Path], workspace: Path) -> Path | None:
    rel = Path(name)
    candidates = [from_file.parent / rel]
    candidates.extend(item / rel for item in inc_dirs)
    for candidate in candidates:
        if not _inside(workspace, candidate):
            continue
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def _rel(root: Path, path: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")
    except (ValueError, OSError):
        return str(path).replace("\\", "/")


def _pick_target(root, wanted: str):
    for target_el in root.iter("Target"):
        name_el = target_el.find("TargetName")
        name = (name_el.text or "").strip() if name_el is not None else ""
        if not name:
            continue
        if not wanted or name == wanted:
            return target_el, name
    return None, wanted


def map_project(project_path: str, target: str, root: str) -> dict:
    p = Path(project_path).resolve()
    if not p.is_file():
        raise FileNotFoundError(f"工程文件不存在: {p}")
    if p.suffix.lower() != ".uvprojx":
        raise ValueError(f"仅支持 .uvprojx 文件，当前: {p.suffix}")
    workspace = Path(root).resolve() if root else p.parent
    tree = ET.parse(str(p))
    xml_root = tree.getroot()
    target_el, target_name = _pick_target(xml_root, (target or "").strip())
    if target_el is None:
        raise ValueError("工程里没有 Target")

    includes: list[str] = []
    defines: list[str] = []
    for ctrl in target_el.iter("VariousControls"):
        includes.extend(_split_inc(ctrl.findtext("IncludePath", default="") or ""))
        defines.extend(_split_def(ctrl.findtext("Define", default="") or ""))
    seen_inc = []
    for item in includes:
        if item not in seen_inc:
            seen_inc.append(item)
    includes_total = len(seen_inc)
    includes = seen_inc[:MAX_MAP_INCLUDES]
    seen_def = []
    for item in defines:
        if item not in seen_def:
            seen_def.append(item)
    defines_total = len(seen_def)
    defines = seen_def[:MAX_MAP_DEFINES]

    inc_rows = []
    for item in includes:
        path = Path(item)
        resolved = path if path.is_absolute() else (p.parent / item)
        inside = _inside(workspace, resolved)
        exists = False
        if inside:
            try:
                exists = resolved.exists()
            except OSError:
                exists = False
        inc_rows.append({
            "path": item.replace("\\", "/"),
            "exists": exists,
            "inside": inside,
        })

    inc_dirs = []
    for row in inc_rows:
        item = Path(row["path"])
        resolved = item if item.is_absolute() else (p.parent / row["path"])
        inc_dirs.append(resolved)

    groups = []
    file_count = 0
    missing = 0
    unreadable = 0
    func_total = 0
    include_edges = []
    files_capped = False
    edges_capped = False
    for group_el in target_el.findall("Groups/Group"):
        gname_el = group_el.find("GroupName")
        gname = (gname_el.text or "").strip() if gname_el is not None else "组"
        files = []
        for file_el in group_el.findall("Files/File"):
            if file_count >= MAX_MAP_FILES:
                files_capped = True
                break
            fname = (file_el.findtext("FileName") or "").strip()
            fpath = (file_el.findtext("FilePath") or fname).strip()
            if not fpath:
                continue
            raw_path = Path(fpath)
            resolved = raw_path if raw_path.is_absolute() else (p.parent / fpath)
            inside = _inside(workspace, resolved)
            exists = False
            readable, reason = False, "outside"
            rel = fname or Path(fpath).name
            if inside:
                try:
                    exists = resolved.is_file()
                except OSError:
                    exists = False
                if not exists:
                    readable, reason = False, "missing"
                    missing += 1
                    rel = _rel(workspace, resolved)
                else:
                    readable, reason = _readable(resolved)
                    if not readable:
                        unreadable += 1
                    rel = _rel(workspace, resolved)
            kind = _kind_of(fname or Path(fpath).name)
            functions = []
            if inside and readable and kind in ("c", "h") and func_total < MAX_FUNCS_TOTAL:
                source = _read_source(resolved)
                if kind == "c":
                    functions = _functions(source)
                    func_total += len(functions)
                for inc_name in _includes_of(source):
                    if len(include_edges) >= MAX_MAP_EDGES:
                        edges_capped = True
                        break
                    dest = _resolve_include(inc_name, resolved, inc_dirs, workspace)
                    dest_inside = bool(dest and _inside(workspace, dest))
                    include_edges.append({
                        "from": rel,
                        "name": inc_name,
                        "to": _rel(workspace, dest) if dest_inside else "",
                        "resolved": dest_inside,
                    })
            files.append({
                "name": fname or Path(fpath).name,
                "kind": kind,
                "rel": rel,
                "exists": exists,
                "readable": readable,
                "reason": "" if readable else reason,
                "inside": inside,
                "functions": functions,
            })
            file_count += 1
        groups.append({"name": gname, "files": files})
        if files_capped:
            break

    return {
        "project": str(p),
        "target": target_name,
        "groups": groups,
        "includes": inc_rows,
        "defines": defines,
        "include_edges": include_edges,
        "truncated": {
            "files": files_capped,
            "includes": includes_total > MAX_MAP_INCLUDES,
            "defines": defines_total > MAX_MAP_DEFINES,
            "include_edges": edges_capped,
            "functions": func_total >= MAX_FUNCS_TOTAL,
        },
        "limits": {
            "files": MAX_MAP_FILES,
            "includes": MAX_MAP_INCLUDES,
            "defines": MAX_MAP_DEFINES,
            "include_edges": MAX_MAP_EDGES,
            "functions": MAX_FUNCS_TOTAL,
        },
        "counts": {
            "groups": len(groups),
            "files": file_count,
            "missing": missing,
            "unreadable": unreadable,
            "includes": len(inc_rows),
            "defines": len(defines),
            "include_edges": len(include_edges),
            "functions": func_total,
        },
    }


def output_json(data: dict):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Keil 工程扫描与 Target 枚举")
    sub = parser.add_subparsers(dest="command")

    scan_p = sub.add_parser("scan", help="搜索工程文件")
    scan_p.add_argument("--root", default=".", help="搜索根目录")
    scan_p.add_argument("--max-results", type=int, default=DEFAULT_MAX_RESULTS, help="最大候选数量，默认 50")
    scan_p.add_argument("--max-depth", type=int, default=DEFAULT_MAX_DEPTH, help="最大扫描深度，默认 8")
    scan_p.add_argument("--json", action="store_true", dest="as_json")

    targets_p = sub.add_parser("targets", help="枚举 Target")
    targets_p.add_argument("--project", required=True, help="工程文件路径")
    targets_p.add_argument("--json", action="store_true", dest="as_json")

    map_p = sub.add_parser("map", help="当前 Target 的组、源文件、包含路径和宏")
    map_p.add_argument("--project", required=True, help="工程文件路径")
    map_p.add_argument("--target", default="", help="Target 名称，空则取第一个")
    map_p.add_argument("--root", default="", help="工作区根，用于 inside 判断")
    map_p.add_argument("--json", action="store_true", dest="as_json")

    args = parser.parse_args()

    if args.command == "scan":
        projects, err = scan_projects(args.root, max_results=args.max_results, max_depth=args.max_depth)
        if err:
            if args.as_json:
                output_json(err)
            else:
                print(f"错误: {err['error']['message']}", file=sys.stderr)
            sys.exit(1)
        result = {
            "status": "ok",
            "action": "scan",
            "details": {"projects": projects, "count": len(projects)},
        }
        if args.as_json:
            output_json(result)
        else:
            if not projects:
                print("未找到 Keil 工程文件")
            else:
                print(f"找到 {len(projects)} 个工程：")
                for i, p in enumerate(projects, 1):
                    print(f"  {i}. [{p['type']}] {p['name']} — {p['path']}")

    elif args.command == "targets":
        try:
            targets = list_targets(args.project)
            result = {
                "status": "ok",
                "action": "targets",
                "details": {
                    "project": args.project,
                    "targets": targets,
                    "count": len(targets),
                },
            }
            if args.as_json:
                output_json(result)
            else:
                if not targets:
                    print("未找到 Target")
                else:
                    print(f"工程 {args.project} 包含 {len(targets)} 个 Target：")
                    for i, t in enumerate(targets, 1):
                        print(f"  {i}. {t['name']}")
        except (FileNotFoundError, ValueError) as e:
            result = {
                "status": "error",
                "action": "targets",
                "error": {"code": "invalid_project", "message": str(e)},
            }
            if args.as_json:
                output_json(result)
            else:
                print(f"错误: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "map":
        try:
            mapped = map_project(args.project, args.target, args.root)
            result = {
                "status": "ok",
                "action": "map",
                "details": mapped,
            }
            if args.as_json:
                output_json(result)
            else:
                print(f"{mapped['target']}: {mapped['counts']['files']} 文件, {mapped['counts']['groups']} 组")
        except (FileNotFoundError, ValueError, ET.ParseError, OSError) as e:
            result = {
                "status": "error",
                "action": "map",
                "error": {"code": "invalid_project", "message": str(e)},
            }
            if args.as_json:
                output_json(result)
            else:
                print(f"错误: {e}", file=sys.stderr)
            sys.exit(1)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
