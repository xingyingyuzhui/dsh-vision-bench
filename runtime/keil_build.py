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
MAX_ERROR_LINES = 8
MAX_EXCERPT_CHARS = 8000
ERRORLEVEL_MAP = {
    0: ("ok", "无错误或警告"),
    1: ("ok", "有警告"),
    2: ("error", "有错误"),
    3: ("error", "致命错误"),
    11: ("error", "无法打开工程文件"),
}

ERROR_LINE = re.compile(
    r"(error:|\berror\s+#|\*\*\*\s*error|createprocess failed|undefined symbol|target not created)",
    re.I,
)
AFTER_BUILD = re.compile(r"user command|after[-\s]?build|running user program", re.I)
COUNT_LINE = re.compile(r"(\d+)\s+Error\(s\)\s*,\s*(\d+)\s+Warning\(s\)")
SIZE_LINE = re.compile(
    r"Program Size:\s+Code=(\d+)\s+RO-data=(\d+)\s+RW-data=(\d+)\s+ZI-data=(\d+)"
)


def output_json(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


def error_result(action: str, code: str, message: str) -> dict:
    return {"status": "error", "action": action, "error": {"code": code, "message": message}}


def read_log_text(log_path: Path) -> str:
    if not log_path.is_file():
        return ""
    raw = log_path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gbk", "cp936"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def toolchain_bins(uv4: str) -> list[str]:
    uv4_path = Path(uv4).resolve()
    root = uv4_path.parent.parent
    found = []
    for rel in (
        ("ARM", "ARMCC", "Bin"),
        ("ARM", "ARMCC", "bin"),
        ("ARM", "ARMCLANG", "bin"),
        ("ARM", "ARMCLANG", "Bin"),
    ):
        candidate = root.joinpath(*rel)
        if candidate.is_dir():
            found.append(str(candidate))
    uv4_dir = str(uv4_path.parent)
    if uv4_dir not in found:
        found.append(uv4_dir)
    return found


def build_env(uv4: str) -> dict[str, str]:
    env = os.environ.copy()
    extra = os.pathsep.join(toolchain_bins(uv4))
    if extra:
        env["PATH"] = extra + os.pathsep + env.get("PATH", "")
    return env


def classify_log(content: str) -> dict:
    lines = content.splitlines()
    after_at = next((i for i, line in enumerate(lines) if AFTER_BUILD.search(line)), None)
    compile_errs: list[str] = []
    after_errs: list[str] = []
    for i, line in enumerate(lines):
        text = line.strip()
        if not text or not ERROR_LINE.search(text):
            continue
        item = text[:240]
        if after_at is not None and i >= after_at:
            after_errs.append(item)
        else:
            compile_errs.append(item)
    metrics = {
        "errors": 0,
        "warnings": 0,
        "compile_errors": len(compile_errs),
        "after_build_errors": len(after_errs),
        "flash_bytes": 0,
        "ram_bytes": 0,
    }
    count_match = None
    for line in reversed(lines):
        count_match = COUNT_LINE.search(line)
        if count_match:
            break
    if count_match:
        metrics["errors"] = int(count_match.group(1))
        metrics["warnings"] = int(count_match.group(2))
    else:
        metrics["errors"] = len(compile_errs) + len(after_errs)
    size_match = SIZE_LINE.search(content)
    if size_match:
        code_size, ro_data, rw_data, zi_data = (int(size_match.group(i)) for i in range(1, 5))
        metrics["flash_bytes"] = code_size + ro_data + rw_data
        metrics["ram_bytes"] = rw_data + zi_data
    errors = (compile_errs + after_errs)[:MAX_ERROR_LINES]
    excerpt = "\n".join(lines[-60:])[:MAX_EXCERPT_CHARS]
    if after_errs and not compile_errs:
        phase = "after_build"
    elif compile_errs:
        phase = "compile"
    else:
        phase = "ok"
    return {
        "metrics": metrics,
        "errors": errors,
        "compile_errors": compile_errs[:MAX_ERROR_LINES],
        "after_build_errors": after_errs[:MAX_ERROR_LINES],
        "phase": phase,
        "excerpt": excerpt,
    }


def parse_log(log_path: Path) -> dict:
    parsed = classify_log(read_log_text(log_path))
    return parsed["metrics"]


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


def run_build(uv4: str, project: str, target: str, log_dir: str, task_id: str = "") -> dict:
    project_path = Path(project).resolve()
    if not project_path.is_file():
        return error_result("build", "project_not_found", f"工程文件不存在: {project_path}")
    if not os.path.isfile(uv4):
        return error_result("build", "uv4_not_found", f"UV4.exe 不存在: {uv4}")
    log_path = Path(log_dir).resolve()
    log_path.mkdir(parents=True, exist_ok=True)
    log_name = f"{task_id}.log" if task_id else f"{project_path.stem}-{(target or 'default').replace(' ', '_')}-build.log"
    log_file = log_path / log_name
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
            env=build_env(uv4),
            **hidden_kwargs(),
        )
    except subprocess.TimeoutExpired:
        return error_result("build", "timeout", f"UV4.exe 执行超时({UV4_TIMEOUT_SEC}s)")
    except OSError as exc:
        return error_result("build", "exec_error", str(exc))
    parsed = classify_log(read_log_text(log_file))
    metrics = parsed["metrics"]
    failed = proc.returncode >= 2 or metrics["compile_errors"] > 0 or metrics["after_build_errors"] > 0 or metrics["errors"] > 0
    status = "error" if failed else "ok"
    _, desc = ERRORLEVEL_MAP.get(proc.returncode, ("error", f"未知返回码: {proc.returncode}"))
    if parsed["phase"] == "after_build":
        desc = "后处理失败（编译/链接已通过）"
        code = "after_build_failed"
        summary = f"后处理失败，after_build={metrics['after_build_errors']} warnings={metrics['warnings']}"
    elif parsed["phase"] == "compile":
        desc = "编译/链接失败"
        code = "compile_failed"
        summary = f"编译/链接失败，errors={metrics['errors']} warnings={metrics['warnings']}"
    else:
        code = "build_failed"
        summary = f"build {'成功' if status == 'ok' else '失败'}，errors={metrics['errors']} warnings={metrics['warnings']}"
    if parsed["errors"]:
        summary += "；" + parsed["errors"][0]
    result = {
        "status": status,
        "action": "build",
        "summary": summary,
        "metrics": metrics,
        "details": {
            "project": str(project_path),
            "target": target,
            "task_id": task_id,
            "log_file": str(log_file),
            "errorlevel": proc.returncode,
            "errorlevel_desc": desc,
            "phase": parsed["phase"],
            "errors": parsed["errors"],
            "compile_errors": parsed["compile_errors"],
            "after_build_errors": parsed["after_build_errors"],
            "excerpt": parsed["excerpt"],
            "path_extra": toolchain_bins(uv4),
            **collect_artifacts(project_path, target),
        },
    }
    if status == "error":
        result["error"] = {"code": code, "message": desc}
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Keil UV4 build")
    parser.add_argument("--uv4", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--target", default="")
    parser.add_argument("--log-dir", required=True)
    parser.add_argument("--task-id", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = run_build(args.uv4, args.project, args.target, args.log_dir, args.task_id)
    output_json(result)
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
