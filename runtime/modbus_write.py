"""One-shot Modbus write for dsh-vision-bench. Connection args only; no disk search."""

from __future__ import annotations

import argparse
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def output_json(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


def error_result(code: str, message: str) -> dict:
    return {"status": "error", "action": "write", "error": {"code": code, "message": message}}


def call_write(client, function: int, address: int, values: list[int], slave: int):
    if function == 5:
        payload = bool(values[0])
        try:
            return client.write_coil(address, payload, slave=slave)
        except TypeError:
            return client.write_coil(address, payload, unit=slave)
    if function == 6:
        try:
            return client.write_register(address, values[0], slave=slave)
        except TypeError:
            return client.write_register(address, values[0], unit=slave)
    if function == 15:
        payload = [bool(v) for v in values]
        try:
            return client.write_coils(address, payload, slave=slave)
        except TypeError:
            return client.write_coils(address, payload, unit=slave)
    try:
        return client.write_registers(address, values, slave=slave)
    except TypeError:
        return client.write_registers(address, values, unit=slave)


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
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

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
        output_json({
            "status": "ok",
            "action": "write",
            "summary": f"写入 f{args.function}@{args.address} 成功",
            "details": {
                "slave": args.slave,
                "function": args.function,
                "address": args.address,
                "count": len(values),
                "values": values,
            },
        })
        return 0
    except Exception as exc:
        output_json(error_result("modbus_exception", str(exc)))
        return 1
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


if __name__ == "__main__":
    raise SystemExit(main())
