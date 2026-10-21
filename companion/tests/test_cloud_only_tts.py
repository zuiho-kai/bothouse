from dataclasses import replace
from unittest.mock import patch
import pytest
from test_voice_device_app import setup
from test_volc_tts import VOICE, creds, fake_client, seconds
from voice.roles import Role, validate_roles
from voice.volc_tts import VolcTTS

def test_cloud_only_default_voice_used(tmp_path):
    seen=[]
    tts=VolcTTS(creds(tmp_path),client=fake_client(seen),default_voice=VOICE)
    assert seconds(tts.synthesize('你好')) == 1.0
    import json
    assert json.loads(seen[0].content)['req_params']['speaker'] == VOICE

def test_cloud_only_build_never_initializes_local_model(tmp_path):
    app,client,bridge,speech=setup(tmp_path)
    from voice.app import build_service
    settings=replace(app.state.service.settings,tts_backend='volc',tts_voice=VOICE,
        tts_volc_credentials=creds(tmp_path))
    with patch('voice.neural_tts.NeuralTTS',side_effect=AssertionError('local model loaded')), \
         patch('voice.speech.Speech') as constructor:
        service=build_service(settings,roles=[Role('gge','G哥')])
        backend=constructor.call_args.kwargs['tts']
        assert isinstance(backend,VolcTTS)
        backend.close()

def test_cloud_only_rejects_local_voice_and_missing_credentials(tmp_path):
    app,client,bridge,speech=setup(tmp_path)
    settings=replace(app.state.service.settings,tts_backend='volc',tts_voice=VOICE,
        tts_volc_credentials=creds(tmp_path))
    settings.validate()
    validate_roles([Role('gge','G哥')],settings)
    with pytest.raises(ValueError):validate_roles([Role('gge','G哥',tts_voice='uncle_fu')],settings)
    with pytest.raises(ValueError):replace(settings,tts_volc_credentials='').validate()
    with pytest.raises(ValueError):replace(settings,tts_voice='uncle_fu').validate()
