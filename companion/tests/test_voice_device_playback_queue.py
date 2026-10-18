import asyncio
import pytest
from voice.device_terminal import DeviceError, DeviceTerminal
from voice.floor import Availability, PartnerAvailability
from test_voice_device_floor_integration import setup, path, payload, finish, play_all

async def test_rejected_decision_has_no_delayed_bridge_input(tmp_path):
    app,a,b,bridge,_=setup(tmp_path)
    async with a,b:
        room=app.state.room
        room.registry.availability=lambda busy=(): [PartnerAvailability('gge',Availability.BUSY),PartnerAvailability('cursor',Availability.AVAILABLE)]
        response=await a.post(path('gge')+'/turn',json=payload())
        await finish(app)
        await asyncio.sleep(.05)
        assert response.status_code==409
        assert not [call for call in bridge.calls if call[0]=='/input']
        assert not bridge.requests and not app.state.service.turns and not room.slots

async def test_cross_device_answers_play_in_admission_order(tmp_path):
    app,a,b,bridge,_=setup(tmp_path)
    async with a,b:
        first,second=payload(),payload('cursor')
        assert (await a.post(path('gge')+'/turn',json=first)).status_code==202
        await finish(app)
        assert (await b.post(path('cursor')+'/turn',json=second)).status_code==202
        await finish(app)
        assert (await a.get(path('gge',first['id']))).json()['playback_allowed']
        assert not (await b.get(path('cursor',second['id']))).json()['playback_allowed']
        # No bypass using a guessed chunk URL while waiting.
        assert (await b.get(path('cursor',second['id'])+'/audio/chunks/0')).status_code==409
        await play_all(a,'gge',first)
        assert (await b.get(path('cursor',second['id']))).json()['playback_allowed']
        await play_all(b,'cursor',second)
        assert [body['project'] for route,body in bridge.calls if route=='/input']==['gge','cursor']

@pytest.mark.parametrize('outcome', ['grant', 'stop', 'abandoned', 'timeout'])
async def test_terminal_wait_ready_waits_for_playback_slot(tmp_path, outcome):
    app,a,b,bridge,_=setup(tmp_path)
    async with a,b:
        first=payload()
        await a.post(path('gge')+'/turn',json=first)
        await finish(app)
        terminal=DeviceTerminal(b,'http://127.0.0.1:8796','desk-cursor',poll_interval=.01)
        await terminal.connect()
        await terminal.ask('请等G哥回答完再播放')
        await finish(app)
        queried = asyncio.Event()
        status = terminal.status

        async def observed_status(turn_id=None):
            result = await status(turn_id)
            queried.set()
            return result

        terminal.status = observed_status
        identifier = terminal.turn_id
        waiting=asyncio.create_task(terminal.wait_ready(timeout=.15 if outcome == 'timeout' else 3))
        try:
            await asyncio.wait_for(queried.wait(), 1)
            premature=waiting.done()
            queued=await terminal.status()
            assert queued['status']=='ready' and queued['playback_allowed'] is False
            if outcome == 'timeout':
                with pytest.raises(DeviceError, match='等待回答超时'):
                    await waiting
                assert terminal.turn_id == identifier and terminal.state == 'waiting'
                assert len(bridge.requests) == 2
                return
            if outcome == 'stop':
                await terminal.stop()
            elif outcome == 'abandoned':
                app.state.room.abandon(app.state.room.records[identifier], 31)
            else:
                await play_all(a,'gge',first)
            ready=await asyncio.wait_for(waiting,1)
            assert not premature, 'wait_ready returned before playback grant; queued snapshot has no audio_chunks'
            if outcome != 'grant':
                assert ready['status'] == 'stopped' and ready['playback_allowed'] is False
                assert 'audio_chunks' not in ready
                assert bool(ready.get('abandoned')) == (outcome == 'abandoned')
                assert app.state.room.active == first['id']
            else:
                assert ready['playback_allowed'] is True
                await terminal.play(ready)
        finally:
            if not waiting.done():
                waiting.cancel()
                await asyncio.gather(waiting,return_exceptions=True)
