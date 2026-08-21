"""One-shot Modbus read for dsh-vision-bench. Connection args only; no disk search."""

from __future__ import annotations

import argparse
import json
import logging
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def output_json(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


def error_result(code: str, message: str) -> dict:
    return {"status": "error", "action": "read", "error": {"code": code, "message": message}}


def translate_serial_error(exc: Exception) -> dict | None:
    """Map Windows/POSIX port-busy errors to an actionable message."""
    text = str(exc)
    lowered = text.lower()
    compact = lowered.replace(" ", "")
    if (
        "permissionerror(13" in compact
        or "errno 13" in lowered
        or "winerror 5" in lowered
        or "access is denied" in lowered
        or "拒绝访问" in text
        or "could not open port" in lowered
        or "device or resource busy" in lowered
    ):
        return error_result(
            "port_busy",
            "串口被其他程序占用（可能：本插件的串口日志监视、其他串口助手未关闭）。请释放该 COM 口后重试",
        )
    return None


class FrameCapture(logging.Handler):
    """Capture pymodbus DEBUG traffic lines so tasks can show raw frames."""

    MARKERS = ("send", "recv", "=>", "<=", " tx", " rx")

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        try:
            text = record.getMessage()
        except Exception:
            return
        lowered = text.lower()
        # pymodbus >=3.9 logs wire frames as "Processing: 0x.." and decodes
        # replies as "decoded PDU .."; older versions used SEND/RECV.
        if (
            "processing:" in lowered
            or "decoded pdu" in lowered
            or any(m in lowered for m in self.MARKERS)
        ):
            self.lines.append(text[-200:])
            self.lines = self.lines[-8:]

    def frames(self) -> dict:
        request = ""
        response = ""
        for line in self.lines:
            lowered = line.lower()
            if "processing:" in lowered:
                request = line
            elif "decoded pdu" in lowered:
                response = line
        if not request:
            for line in self.lines:
                if any(m in line.lower() for m in ("send", "=>", " tx")):
                    request = line
                    break
        if not response:
            for line in reversed(self.lines):
                if any(m in line.lower() for m in ("recv", "<=", " rx")):
                    response = line
                    break
        return {"request": request, "response": response, "trace": list(self.lines)}


def attach_frame_capture() -> FrameCapture | None:
    capture = FrameCapture()
    logger = logging.getLogger("pymodbus")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(capture)
    return capture


def call_read(client, function: int, address: int, count: int, slave: int):
    """Call a read method across pymodbus 3.15+ (device_id), 3.x (slave) and 2.x (unit)."""
    names = {
        1: "read_coils",
        2: "read_discrete_inputs",
        3: "read_holding_registers",
        4: "read_input_registers",
    }
    method = getattr(client, names[function])
    attempts = (
        {"count": count, "device_id": slave},
        {"count": count, "slave": slave},
        {"count": count, "unit": slave},
    )
    last = None
    for kwargs in attempts:
        try:
            return method(address, **kwargs)
        except TypeError as exc:
            last = exc
    raise last


def main() -> int:
    parser = argparse.ArgumentParser(description="Modbus read")
    parser.add_argument("--mode", choices=["rtu", "tcp"], required=True)
    parser.add_argument("--port", default="")
    parser.add_argument("--baudrate", type=int, default=9600)
    parser.add_argument("--host", default="")
    parser.add_argument("--tcp-port", type=int, default=502)
    parser.add_argument("--slave", type=int, default=1)
    parser.add_argument("--function", type=int, choices=[1, 2, 3, 4], required=True)
    parser.add_argument("--address", type=int, required=True)
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=1.0)
    parser.add_argument("--debug", action="store_true", help="capture raw frames into details.frames")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    capture = attach_frame_capture() if args.debug else None

    try:
        from pymodbus.client import ModbusSerialClient, ModbusTcpClient
    except ImportError:
        output_json(error_result("pymodbus_missing", "未安装 pymodbus。请在绑定的 Python 中执行: pip install pymodbus pyserial"))
        return 1

    if args.mode == "rtu":
        if not args.port:
            output_json(error_result("missing_port", "RTU 模式需要串口，例如 COM3 或 /dev/ttyUSB0"))
            return 1
        client = ModbusSerialClient(
            port=args.port,
            baudrate=args.baudrate,
            timeout=args.timeout,
        )
    else:
        if not args.host:
            output_json(error_result("missing_host", "TCP 模式需要主机地址"))
            return 1
        client = ModbusTcpClient(host=args.host, port=args.tcp_port, timeout=args.timeout)

    try:
        connected = client.connect()
        if not connected:
            output_json(error_result("connect_failed", "无法连接设备"))
            return 1
        response = call_read(client, args.function, args.address, args.count, args.slave)
        if hasattr(response, "isError") and response.isError():
            output_json(error_result("modbus_exception", str(response)))
            return 1
        if args.function in (1, 2):
            raw = list(getattr(response, "bits", []) or [])[: args.count]
        else:
            raw = list(getattr(response, "registers", []) or [])[: args.count]
        value = raw[0] if len(raw) == 1 else raw
        details = {
            "slave": args.slave,
            "function": args.function,
            "address": args.address,
            "count": args.count,
            "raw": raw,
            "value": value,
        }
        if capture is not None:
            details["frames"] = capture.frames()
        output_json({
            "status": "ok",
            "action": "read",
            "summary": f"读取 f{args.function}@{args.address} 成功",
            "details": details,
        })
        return 0
    except Exception as exc:
        busy = translate_serial_error(exc)
        output_json(busy or error_result("modbus_exception", str(exc)))
        return 1
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


if __name__ == "__main__":
    raise SystemExit(main())
