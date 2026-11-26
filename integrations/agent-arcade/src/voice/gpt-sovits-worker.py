"""Optional local Serena TTS: fixed verified assets, JSON control, in-memory PCM.

This worker has no microphone or network listener. The owning Node provider kills
its owned host to stop active work. Idle models stay resident.
"""
import sys, os, json, pathlib, hashlib, socket, re, base64
PROTOCOL=sys.stdout
sys.stdout=sys.stderr  # Third-party status/text prints never enter the protocol.
RENDER_ONLY = len(sys.argv) == 5 and sys.platform == 'darwin' and sys.argv[4] == '--render-only'
NONCE = sys.argv[3] if RENDER_ONLY else None
if RENDER_ONLY and not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', NONCE):
    raise SystemExit(2)
if (not RENDER_ONLY and len(sys.argv)!=3) or any('\0' in value or value.startswith(('//','\\\\')) for value in sys.argv[1:3]):raise SystemExit(2)
REPO=pathlib.Path(sys.argv[1]).resolve()
REFERENCE=pathlib.Path(sys.argv[2]).resolve()
REFERENCE_HASH='20a9b9c687db1dc2e9c5783c3e915c9694e49118fff9e72dad56b1c32a37d179'
REFERENCE_TEXT='晚上好，今天过得怎么样？不着急，慢慢说，我在听。'
MAX_TEXT=2000
MAX_SECONDS=180
MAX_SEGMENT_SECONDS=40
MAX_RENDER_SAMPLES=960000
RENDER_FRAME_BYTES=8192
MAX_RENDER_FRAMES=512
def emit(event,**values):
    PROTOCOL.write(json.dumps({'event':event,**values},ensure_ascii=False,separators=(',',':'))+'\n');PROTOCOL.flush()
def no_network(*args,**kwargs):raise RuntimeError('Network disabled for local voice')
socket.socket.connect=no_network
socket.create_connection=no_network
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
MODEL=None

def verify_assets():
    expected={
      's1v3.ckpt':'87133414860ea14ff6620c483a3db5ed07b44be42e2c3fcdad65523a729a745a',
      'v2Pro/s2Gv2ProPlus.pth':'d42a22bbbf65fb2bbdd45ad6a66841156977db45c7aabe0a6992ff378d9c7d3b',
      'sv/pretrained_eres2netv2w24s4ep4.ckpt':'4f5a0bf73c61eb41b174e1bb54e7ee3c83233892be8e0af1f187024e8e581a35',
      'chinese-hubert-base/pytorch_model.bin':'24164f129c66499d1346e2aa55f183250c223161ec2770c0da3d3b08cf432d3c',
      'chinese-roberta-wwm-ext-large/pytorch_model.bin':'e53a693acc59ace251d143d068096ae0d7b79e4b1b503fa84c9dcf576448c1d8',
    }
    if not (REPO/'GPT_SoVITS/TTS_infer_pack/TTS.py').is_file() or not REFERENCE.is_file():raise ValueError('voice_assets')
    if hashlib.sha256(REFERENCE.read_bytes()).hexdigest()!=REFERENCE_HASH:raise ValueError('voice_assets')
    for name,sha in expected.items():
        digest=hashlib.sha256()
        with (REPO/'GPT_SoVITS/pretrained_models'/name).open('rb') as data:
            for block in iter(lambda:data.read(4*1024*1024),b''):digest.update(block)
        if digest.hexdigest()!=sha:raise ValueError('voice_assets')
    digest=hashlib.sha256()
    with (REPO/'GPT_SoVITS/text/G2PWModel/g2pW.onnx').open('rb') as data:
        for block in iter(lambda:data.read(4*1024*1024),b''):digest.update(block)
    if digest.hexdigest()!='2eb3c71fd95117b2e1abef8d2d0cd78aae894bbe7f0fac105ddc9c32ce63cbd0':raise ValueError('voice_assets')

def get_model():
    global MODEL
    if MODEL is not None:return MODEL
    verify_assets()
    os.chdir(REPO);sys.path.insert(0,str(REPO));sys.path.insert(0,str(REPO/'GPT_SoVITS'))
    import torch, torchaudio, soundfile as sf
    torch.set_num_threads(1)
    if RENDER_ONLY:
        device, half = 'cpu', False
    else:
        if not torch.cuda.is_available():raise ValueError('voice_unavailable')
        device, half = 'cuda', True
    audio,rate=sf.read(str(REFERENCE),dtype='float32',always_2d=True)
    if rate!=24000 or audio.shape[1]!=1 or not 3<=len(audio)/rate<=10:raise ValueError('voice_assets')
    def fixed_reference(path,*args,**kwargs):
        if pathlib.Path(path).resolve()!=REFERENCE:raise ValueError('voice_assets')
        return torch.from_numpy(audio.T.copy()),rate
    torchaudio.load=fixed_reference
    from TTS_infer_pack.TTS import TTS,TTS_Config
    import fast_langdetect
    local_detector=pathlib.Path(fast_langdetect.__file__).resolve().parent/'resources/lid.176.ftz'
    if not local_detector.is_file():raise ValueError('voice_assets')
    fast_langdetect.infer._default_detector=fast_langdetect.infer.LangDetector(
        fast_langdetect.infer.LangDetectConfig(custom_model_path=str(local_detector),allow_fallback=False))
    pre=REPO/'GPT_SoVITS/pretrained_models'
    config=TTS_Config({'custom':{'device':device,'is_half':half,'version':'v2ProPlus','t2s_weights_path':str(pre/'s1v3.ckpt'),'vits_weights_path':str(pre/'v2Pro/s2Gv2ProPlus.pth'),'bert_base_path':str(pre/'chinese-roberta-wwm-ext-large'),'cnhuhbert_base_path':str(pre/'chinese-hubert-base')}})
    config.save_configs=lambda *args,**kwargs:None
    MODEL=TTS(config)
    return MODEL

def segments(text):
    chunks=[];pending=''
    for piece in re.findall(r'[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+',text):
        if len(pending)+len(piece)<=120:pending+=piece;continue
        if pending.strip():chunks.append(pending.strip())
        pending=''
        while len(piece)>120:chunks.append(piece[:120]);piece=piece[120:]
        pending=piece
    if pending.strip():chunks.append(pending.strip())
    if not chunks or len(chunks)>40:raise ValueError('voice_limit')
    return chunks

def synthesis_options(text):
    return {'text':text,'text_lang':'all_zh','ref_audio_path':str(REFERENCE),'prompt_text':REFERENCE_TEXT,'prompt_lang':'all_zh','batch_size':1,'text_split_method':'cut0','seed':20261105,'streaming_mode':False,'gpt_streaming':False,'parallel_infer':False,'split_bucket':False,'use_cuda_graph':False,'use_flash_attention':False,'speed_factor':1.0,'super_sampling':False}

def valid_render_text(text):
    return isinstance(text,str) and bool(text.strip()) and len(text)<=120 and not any(ord(char)<32 and char not in '\t\n\r' or ord(char)==127 or 0xd800<=ord(char)<=0xdfff for char in text)

def render(identifier,text,clean=False):
    # No sounddevice import, output-device query, file output or audio playback.
    # The normal completion event is emitted only after the upstream generator
    # terminates successfully; its error fallback/silence is never a result.
    if not valid_render_text(text):raise ValueError('voice_limit')
    import numpy as np, torch
    model=get_model();samples=0;sequence=0;digest=hashlib.sha256();nonzero=False
    emit('render-start',id=identifier,sampleRate=32000,channels=1,bits=16)
    with torch.inference_mode():
        for rate,pcm in model.run(synthesis_options(text)):
            pcm=np.asarray(pcm)
            if rate!=32000 or pcm.ndim!=1 or not pcm.size or pcm.dtype!=np.int16:raise ValueError('voice_unavailable')
            if samples+pcm.size>MAX_RENDER_SAMPLES:raise ValueError('voice_limit')
            samples+=int(pcm.size);nonzero=nonzero or bool(np.any(pcm))
            # Limit copies to a protocol frame; do not build a second full PCM.
            for offset in range(0,pcm.size,RENDER_FRAME_BYTES//2):
                block=pcm[offset:offset+RENDER_FRAME_BYTES//2].astype('<i2',copy=False).tobytes()
                sequence+=1
                if sequence>MAX_RENDER_FRAMES:raise ValueError('voice_limit')
                digest.update(block)
                emit('render-pcm',id=identifier,seq=sequence,samples=len(block)//2,data=base64.b64encode(block).decode('ascii'))
            if clean:pcm.fill(0)
            block=None;pcm=None
    if samples<6400 or not nonzero:raise ValueError('voice_limit' if samples<6400 else 'voice_unavailable')
    completed={'frames':sequence,'samples':samples,'sha256':digest.hexdigest()}
    if clean:return completed
    emit('render-end',id=identifier,**completed)

def speak(identifier,text):
    import numpy as np, torch, sounddevice as sd
    chunks=segments(text)
    model=get_model();started=False;seconds=0
    for index,segment in enumerate(chunks,1):
        options=synthesis_options(segment)
        emit('synthesis-start',id=identifier,segment=index,segments=len(chunks),characters=len(segment))
        segment_ready=False
        with torch.inference_mode():
            for rate,pcm in model.run(options):
                pcm=np.asarray(pcm)
                if rate!=32000 or pcm.ndim!=1 or not pcm.size or not np.isfinite(pcm).all():raise ValueError('voice_unavailable')
                duration=pcm.size/rate;seconds+=duration
                if duration>MAX_SEGMENT_SECONDS or seconds>MAX_SECONDS:raise ValueError('voice_limit')
                if pcm.dtype!=np.int16:raise ValueError('voice_unavailable')
                # PCM readiness is not playback. Report only the first validated
                # block per segment, without retaining its samples or text.
                if not segment_ready:
                    segment_ready=True;emit('pcm-ready',id=identifier,segment=index,sampleRate=rate,samples=int(pcm.size))
                # One bounded segment at a time. Process termination closes this output.
                with sd.RawOutputStream(samplerate=rate,channels=1,dtype='int16',blocksize=320,latency='low') as output:
                    for offset in range(0,pcm.size,320):
                        output.write(pcm[offset:offset+320].tobytes())
                        if not started:started=True;emit('playback-start',id=identifier)
        if not segment_ready:raise ValueError('voice_unavailable')
    if not started:raise ValueError('voice_unavailable')
    emit('playback-end',id=identifier,cancelled=False)

def main():
    # Starting a render host and reading capabilities never touches a device.
    identity = {'nonce': NONCE, 'pid': os.getpid(), 'parentPid': os.getppid()} if RENDER_ONLY else {}
    emit('ready',outputAvailable=False,outputDevice='',outputChecked=False,renderAvailable=True,**identity)
    while True:
        raw=sys.stdin.buffer.readline(16385)
        if not raw:return
        if len(raw)>16384 or not raw.endswith(b'\n'):return
        identifier=None
        try:
            row=json.loads(raw);identifier=row.get('id');op=row.get('op')
            if not isinstance(identifier,str) or len(identifier)>80 or (RENDER_ONLY and op!='render'):return
            if op=='warmup' and set(row)=={'id','op'}:get_model();emit('warm',id=identifier)
            elif op=='render' and set(row)=={'id','op','text'}:render(identifier,row['text'])
            elif op=='render' and set(row)=={'id','op','text','clean'} and row['clean'] is True:
                # Only the QQ render caller requests this clean terminal. The
                # completed generator/frame releases its PCM and request text;
                # immutable Python strings are dereferenced, not securely erased.
                completed=render(identifier,row['text'],clean=True)
                row=None;raw=None;text=None
                emit('render-end',id=identifier,cleaned=True,**completed)
                completed=None
            elif op=='speak' and set(row)=={'id','op','text'}:
                text=row['text']
                if not isinstance(text,str) or not text.strip() or len(text)>MAX_TEXT:raise ValueError('voice_limit')
                try:
                    import sounddevice as sd
                    device=sd.query_devices(kind='output')
                    sd.check_output_settings(samplerate=32000,channels=1,dtype='int16')
                    if device['max_output_channels']<=0:raise ValueError('voice_output')
                except Exception:raise ValueError('voice_output')
                name=''.join(char for char in str(device['name']) if ord(char)>=32 and ord(char)!=127)[:240]
                emit('output-ready',id=identifier,outputAvailable=True,outputDevice=name)
                speak(identifier,text)
            else:return
        except Exception as error:
            code=str(error) if isinstance(error,ValueError) and str(error) in {'voice_assets','voice_output','voice_limit','voice_locale'} else 'voice_unavailable'
            emit('error',id=identifier if isinstance(identifier,str) else '',code=code)

if __name__=='__main__':main()
