"""Keil MDK 工程扫描与 Target 枚举"""

import argparse
import json
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
    """递归搜索 .uvprojx 和 .uvmpw 文件，默认限制在工作区范围内。"""
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
            if p.suffix.lower() not in (".uvprojx", ".uvmpw"):
                continue
            projects.append({
                "path": str(p),
                "name": p.stem,
                "type": "workspace" if p.suffix == ".uvmpw" else "project",
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
    if p.suffix != ".uvprojx":
        raise ValueError(f"仅支持 .uvprojx 文件，当前: {p.suffix}")

    tree = ET.parse(str(p))
    root = tree.getroot()
    targets = []
    for target_el in root.iter("Target"):
        name_el = target_el.find("TargetName")
        if name_el is not None and name_el.text:
            targets.append({"name": name_el.text.strip()})
    return targets


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

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
