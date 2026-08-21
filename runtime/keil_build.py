"""Keil UV4 build for dsh-vision-bench. JSON only. No disk search."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

UV4_TIMEOUT_SEC = 600
ERRORLEVEL_MAP = {
    0: ("ok", "无错误或警告"),
    1: ("ok", "有警告"),
    2: ("error", "有错误"),
    3: ("error", "致命错误"),
    11: ("error", "无法打开工程文件"),
}


def output_json(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


def error_result(action: str, code: str, message: str) -> dict:
    return {"status": "error", "action": action, "error": {"code": code, "message": message}}


def parse_log(log_path: Path) -> dict:
    metrics = {"errors": 0, "warnings": 0, "flash_bytes": 0, "ram_bytes": 0}
    if not log_path.is_file():
        return metrics
    content = log_path.read_text(encoding="utf-8", errors="replace")
    error_match = re.search(r"(\d+)\s+Error\(s\)\s*,\s*(\d+)\s+Warning\(s\)", content)
    if error_match:
        metrics["errors"] = int(error_match.group(1))
        metrics["warnings"] = int(error_match.group(2))
    size_match = re.search(
        r"Program Size:\s+Code=(\d+)\s+RO-data=(\d+)\s+RW-data=(\d+)\s+ZI-data=(\d+)",
        content,
    )
    if size_match:
        code_size, ro_data, rw_data, zi_data = (int(size_match.group(i)) for i in range(1, 5))
        metrics["flash_bytes"] = code_size + ro_data + rw_data
        metrics["ram_bytes"] = rw_data + zi_data
    return metrics


def collect_artifacts(project_path: Path, target: str) -> dict:
    if project_path.suffix.lower() != ".uvprojx":
        return {}
    try:
        root = ET.parse(str(project_path)).getroot()
    except (ET.ParseError, OSError):
        return {}
    target_el = None
    fallback = None
    for item in root.iter("Target"):
        name_el = item.find("TargetName")
        if name_el is None or not name_el.text:
            continue
        if fallback is None:
            fallback = item
        if target and name_el.text.strip() == target:
            target_el = item
            break
    target_el = target_el or fallback
    if target_el is None:
        return {}
    common = target_el.find("TargetOption/TargetCommonOption")
    if common is None:
        return {}
    raw_dir = (common.findtext("OutputDirectory", default="") or "").strip()
    output_dir = Path(raw_dir) if Path(raw_dir).is_absolute() else (project_path.parent / raw_dir)
    output_name = (common.findtext("OutputName", default="") or "").strip() or project_path.stem
    details: dict[str, str] = {}
    for suffix, key in ((".axf", "axf_file"), (".elf", "elf_file"), (".hex", "hex_file"), (".bin", "bin_file")):
        candidate = output_dir / f"{output_name}{suffix}"
        if candidate.is_file():
            details[key] = str(candidate.resolve())
    details["debug_file"] = details.get("elf_file") or details.get("axf_file") or ""
    details["flash_file"] = details.get("hex_file") or details.get("bin_file") or details.get("debug_file") or ""
    if output_dir.exists():
        details["output_dir"] = str(output_dir.resolve())
    return {key: value for key, value in details.items() if value}


def hidden_kwargs() -> dict:
    if os.name != "nt":
        return {}
    return {"creationflags": 0x08000000}


def run_build(uv4: str, project: str, target: str, log_dir: str) -> dict:
    project_path = Path(project).resolve()
    if not project_path.is_file():
        return error_result("build", "project_not_found", f"工程文件不存在: {project_path}")
    if not os.path.isfile(uv4):
        return error_result("build", "uv4_not_found", f"UV4.exe 不存在: {uv4}")
    log_path = Path(log_dir).resolve()
    log_path.mkdir(parents=True, exist_ok=True)
    log_file = log_path / f"{project_path.stem}-{target or 'default'}-build.log"
    cmd = [uv4, "-b", str(project_path), "-j0", "-o", str(log_file)]
    if target:
        cmd.extend(["-t", target])
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=UV4_TIMEOUT_SEC,
            cwd=str(project_path.parent),
            encoding="utf-8",
            errors="replace",
            **hidden_kwargs(),
        )
    except subprocess.TimeoutExpired:
        return error_result("build", "timeout", f"UV4.exe 执行超时({UV4_TIMEOUT_SEC}s)")
    except OSError as exc:
        return error_result("build", "exec_error", str(exc))
    metrics = parse_log(log_file)
    status = "error" if proc.returncode >= 2 or metrics["errors"] > 0 else "ok"
    _, desc = ERRORLEVEL_MAP.get(proc.returncode, ("error", f"未知返回码: {proc.returncode}"))
    result = {
        "status": status,
        "action": "build",
        "summary": f"build {'成功' if status == 'ok' else '失败'}，errors={metrics['errors']} warnings={metrics['warnings']}",
        "metrics": metrics,
        "details": {
            "project": str(project_path),
            "target": target,
            "log_file": str(log_file),
            "errorlevel": proc.returncode,
            "errorlevel_desc": desc,
            **collect_artifacts(project_path, target),
        },
    }
    if status == "error":
        result["error"] = {"code": "build_failed", "message": desc}
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Keil UV4 build")
    parser.add_argument("--uv4", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--target", default="")
    parser.add_argument("--log-dir", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = run_build(args.uv4, args.project, args.target, args.log_dir)
    output_json(result)
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
