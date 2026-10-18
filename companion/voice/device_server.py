"""Explicit entry point for desktop and LAN device terminals.

The default stays on 127.0.0.1. Binding another address requires a per-device
secret for every device, and turns the HTML pages and device list into
loopback-only surfaces.
"""
import argparse
import json
from pathlib import Path

from .device_app import create_device_app
from .devices import read_devices
from .roles import read_roles
from .settings import Settings


def read_settings(path):
    values = json.loads(path.expanduser().read_text())
    if not isinstance(values, dict) or 'port' not in values:
        raise ValueError('设备入口必须显式配置 port。')
    return Settings(**values).validate()


def main():
    parser = argparse.ArgumentParser(description='共栖：电脑模拟固定伙伴设备')
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--roles', type=Path, required=True)
    parser.add_argument('--devices', type=Path, required=True)
    parser.add_argument('--host', default='127.0.0.1',
                        help='监听地址；非本机地址要求每台设备都有独立凭据')
    args = parser.parse_args()
    settings, roles = read_settings(args.config), read_roles(args.roles)
    registry = read_devices(args.devices, roles)
    app = create_device_app(settings, registry, roles=roles, host=args.host)
    import uvicorn
    uvicorn.run(app, host=args.host, port=settings.port, log_config=timestamped_log_config())


def timestamped_log_config():
    """Access lines carry only paths and turn IDs; timestamps let them line up
    with shared-memory events when diagnosing a 409 or a held slot."""
    import copy
    from uvicorn.config import LOGGING_CONFIG
    config = copy.deepcopy(LOGGING_CONFIG)
    for formatter in config['formatters'].values():
        formatter['fmt'] = '%(asctime)s ' + formatter['fmt']
    return config


if __name__ == '__main__':
    main()
