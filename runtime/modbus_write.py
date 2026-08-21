"""One-shot Modbus write for dsh-vision-bench. Connection args only; no disk search."""

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
    return {"status": "error", "action": "write", "error": {"code": code, "message": message}}


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


def call_write(client, function: int, address: int, values: list[int], slave: int):
    """Call a write method across pymodbus 3.15+ (device_id), 3.x (slave) and 2.x (unit)."""
    if function == 5:
        payloads = (
            ((address,), {"value": bool(values[0]), "device_id": slave}),
            ((address,), {"value": bool(values[0]), "slave": slave}),
            ((address,), {"value": bool(values[0]), "unit": slave}),
        )
        names = ("write_coil", "write_coil", "write_coil")
    elif function == 6:
        payloads = (
            ((address,), {"value": values[0], "device_id": slave}),
            ((address,), {"value": values[0], "slave": slave}),
            ((address,), {"value": values[0], "unit": slave}),
        )
        names = ("write_register", "write_register", "write_register")
    elif function == 15:
        payload = [bool(v) for v in values]
        payloads = (
            ((address,), {"values": payload, "device_id": slave}),
            ((address,), {"values": payload, "slave": slave}),
            ((address,), {"values": payload, "unit": slave}),
        )
        names = ("write_coils", "write_coils", "write_coils")
    else:
        payloads = (
            ((address,), {"values": values, "device_id": slave}),
            ((address,), {"values": values, "slave": slave}),
            ((address,), {"values": values, "unit": slave}),
        )
        names = ("write_registers", "write_registers", "write_registers")
    last = None
    for name, (args, kwargs) in zip(names, payloads):
        method = getattr(client, name)
        try:
            return method(*args, **kwargs)
        except TypeError as exc:
            last = exc
    raise last


def main() -> int:
    parser = argparse.ArgumentParser(description="Modbus write")
    parser.add_argument("--mode", choices=["rtu", "tcp"], required=True)
    parser.add_argument("--port", default="")
    parser.add_argument("--baudrate", type=int, default=9600)
    parser.add_argument("--host", default="")
    parser.add_argument("--tcp-port", type=int, default=502)
    parser.add_argument("--slave", type=int, default=1)
    parser.add_argument("--function", type=int, choices=[5, 6, 15, 16], required=True)
    parser.add_argument("--address", type=int, required=True)
    parser.add_argument(
        "--values",
        required=True,
        help="comma-separated integers, e.g. 1 or 12,34,56",
    )
    parser.add_argument("--timeout", type=float, default=1.0)
    parser.add_argument("--debug", action="store_true", help="capture raw frames into details.frames")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    capture = attach_frame_capture() if args.debug else None

    try:
        values = [int(part.strip()) for part in str(args.values).split(",") if part.strip() != ""]
    except ValueError:
        output_json(error_result("bad_values", "写入值必须是逗号分隔的整数"))
        return 1
    if not values:
        output_json(error_result("bad_values", "缺少写入值"))
        return 1
    if args.function in (5, 6) and len(values) != 1:
        output_json(error_result("bad_values", "单点写入只需要一个值"))
        return 1
    if args.function == 5 and values[0] not in (0, 1):
        output_json(error_result("bad_values", "线圈值只能是 0 或 1"))
        return 1
    for value in values:
        if value < 0 or value > 65535:
            output_json(error_result("bad_values", "寄存器值必须在 0–65535"))
            return 1
    if args.function == 15 and len(values) > 1968:
        output_json(error_result("bad_values", "线圈批量写入最多 1968 个"))
        return 1
    if args.function == 16 and len(values) > 123:
        output_json(error_result("bad_values", "寄存器批量写入最多 123 个"))
        return 1

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
        response = call_write(client, args.function, args.address, values, args.slave)
        if hasattr(response, "isError") and response.isError():
            output_json(error_result("modbus_exception", str(response)))
            return 1
        details = {
            "slave": args.slave,
            "function": args.function,
            "address": args.address,
            "count": len(values),
            "values": values,
        }
        if capture is not None:
            details["frames"] = capture.frames()
        output_json({
            "status": "ok",
            "action": "write",
            "summary": f"写入 f{args.function}@{args.address} 成功",
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
