import base64
import io
import json
import wave

import httpx
import pytest

from voice.roles import Role
from voice.volc_tts import HybridTTS, VolcTTS, is_volc_voice, resource_for

VOICE = 'zh_female_sajiaoxuemei_uranus_bigtts'


def creds(tmp_path):
    path = tmp_path / 'volc.json'
    path.write_text(json.dumps({'access_token': 'k-123'}), encoding='utf-8')
    return str(path)


def fake_client(seen, pcm=b'\x01\x00' * 24000, code=0):
    def handler(request):
        seen.append(request)
        half = len(pcm) // 2
        lines = [json.dumps({'code': 0, 'data': base64.b64encode(pcm[:half]).decode()}),
                 json.dumps({'code': 0, 'data': base64.b64encode(pcm[half:]).decode()}),
                 json.dumps({'code': code or 20000000, 'message': 'ok' if not code else 'bad'})]
        return httpx.Response(200, content=('\n'.join(lines) + '\n').encode())
    return httpx.Client(transport=httpx.MockTransport(handler))


def seconds(wav):
    with wave.open(io.BytesIO(wav), 'rb') as w:
        return w.getnframes() / w.getframerate()


def test_voice_ids_and_resource():
    assert is_volc_voice(VOICE)
    assert not is_volc_voice('vivian')
    assert resource_for(VOICE) == 'seed-tts-2.0'
    assert resource_for('zh_female_shuangkuaisisi_moon_bigtts') == 'seed-tts-1.0'


def test_stream_sends_api_key_and_returns_whole_audio(tmp_path):
    seen, chunks = [], []
    tts = VolcTTS(creds(tmp_path), client=fake_client(seen))
    wav = tts.synthesize_stream('你好', chunks.append, voice=VOICE)
    req = seen[0]
    assert req.headers['X-Api-Key'] == 'k-123'
    assert req.headers['X-Api-Resource-Id'] == 'seed-tts-2.0'
    assert json.loads(req.content)['req_params']['speaker'] == VOICE
    assert seconds(wav) == pytest.approx(1.0)
    assert sum(seconds(c) for c in chunks) == pytest.approx(1.0)
    assert len(chunks) == 2  # 0.6 s + remainder


def test_error_code_raises(tmp_path):
    tts = VolcTTS(creds(tmp_path), client=fake_client([], code=45000010))
    with pytest.raises(RuntimeError):
        tts.synthesize('你好', voice=VOICE)


def test_missing_token_rejected(tmp_path):
    path = tmp_path / 'volc.json'
    path.write_text('{"app_id": "x"}', encoding='utf-8')
    with pytest.raises(ValueError):
        VolcTTS(str(path))


def test_hybrid_routes_by_voice(tmp_path):
    class Local:
        def __init__(self):
            self.calls = []

        def synthesize(self, text, *, voice=None):
            self.calls.append(voice)
            return b'local'

        def close(self):
            pass

    local = Local()
    hybrid = HybridTTS(local, VolcTTS(creds(tmp_path), client=fake_client([])))
    assert hybrid.synthesize('hi', voice='vivian') == b'local'
    assert seconds(hybrid.synthesize('hi', voice=VOICE)) == pytest.approx(1.0)
    assert local.calls == ['vivian']


def test_role_accepts_volc_voice_but_not_garbage():
    Role(project='cjiang', name='C酱', tts_voice=VOICE)
    with pytest.raises(ValueError):
        Role(project='cjiang', name='C酱', tts_voice='no such voice')
