"""Explicit, localhost-only entry point for desktop device simulation."""
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
    args = parser.parse_args()
    settings, roles = read_settings(args.config), read_roles(args.roles)
    registry = read_devices(args.devices, roles)
    import uvicorn
    uvicorn.run(create_device_app(settings, registry, roles=roles), host='127.0.0.1', port=settings.port,
                log_config=timestamped_log_config())


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
