import copy
import json

import pytest

from autonomy.__main__ import OWNER, install
from test_instance_isolation import EXAMPLES, SharedBridge


@pytest.mark.parametrize('command', [None, 'python -m autonomy tick',
                                   'python -m autonomy --config=/another/config.json tick',
                                   "python -m autonomy --config 'broken",
                                   'python -m autonomy --config relative.json tick'])
def test_same_leader_and_channel_do_not_prove_cron_ownership(tmp_path, command):
    config = json.loads((EXAMPLES / 'autonomy-config.example.json').read_text())
    bridge = SharedBridge()
    bridge.jobs = [{'id': 'old', 'description': OWNER, 'project': config['leader'],
                    'session_key': 'discord:' + config['main_channel'], 'exec': command}]
    before = copy.deepcopy(bridge.jobs)
    with pytest.raises(ValueError, match='foreign'):
        install(config, tmp_path / 'config.json', bridge)
    assert bridge.jobs == before
    assert bridge.calls == [('/cron/list', None)]


def test_explicit_equals_config_owned_cron_is_reused(tmp_path):
    config = json.loads((EXAMPLES / 'autonomy-config.example.json').read_text())
    path = tmp_path / 'config.json'
    bridge = SharedBridge()
    bridge.jobs = [{'id': 'old', 'description': OWNER, 'project': config['leader'],
                    'session_key': 'discord:' + config['main_channel'],
                    'exec': f'python -m autonomy --config={path} tick'}]
    assert install(config, path, bridge) == 'old'
    assert len(bridge.jobs) == 1
