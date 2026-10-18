(() => {
  const root = document.getElementById('conest-device-ui');
  const stateSelect = root.querySelector('#cn-preview-state');
  const charSelect = root.querySelector('#cn-preview-character');
  const scaleSelect = root.querySelector('#cn-preview-scale');
  const interactionSelect = root.querySelector('#cn-interaction-mode');
  const thinkingSelect = root.querySelector('#cn-thinking-mode');
  const motionToggle = root.querySelector('#cn-motion-toggle');
  const assetClipEl = root.querySelector('#cn-asset-clip');
  const assetNoteEl = root.querySelector('#cn-asset-note');
  const primarySizeLabel = root.querySelector('#cn-primary-size-label');
  const zoomCard = root.querySelector('#cn-zoom-card');
  const legacyCard = root.querySelector('#cn-legacy-card');
  const shells = [...root.querySelectorAll('.cn-device-shell')];
  const voiceEndpointSelect = root.querySelector('#cn-voice-endpoint');
  const voiceConnectBtn = root.querySelector('#cn-voice-connect');
  const voiceStatusEl = root.querySelector('#cn-voice-status');
  const voiceForm = root.querySelector('#cn-voice-form');
  const voiceTextInput = root.querySelector('#cn-voice-text');
  const voiceSendBtn = root.querySelector('#cn-voice-send');
  const voiceStopBtn = root.querySelector('#cn-voice-stop');
  const telemetryPhaseEl = root.querySelector('#cn-telemetry-phase');
  const telemetryPlaybackEl = root.querySelector('#cn-telemetry-playback');
  const telemetryTextEl = root.querySelector('#cn-telemetry-text');
  const voiceAudio = root.querySelector('#cn-voice-audio');

  const VALID_PHASES = ['idle', 'listening', 'thinking', 'speaking', 'peer', 'busy', 'stopping', 'error', 'offline'];
  const VALID_CHARS = ['gpt', 'claude', 'deepseek'];
  const VALID_INTERACTIONS = ['touch', 'active-only', 'hidden'];

  /*
   * 逐角色、逐状态视频校准表：
   * - 针对每段视频的实际人物比例、脸部中心（face_cx / face_cy）与内嵌圆底盘半径单独设定 scale / tx / ty
   * - 所有视频均在前端锁死静音（muted + volume=0）
   * - 对缺失专用动作的角色（如 GPT 缺专用 speaking、DeepSeek 缺 thinking）诚实标注，不冒充完整口型同步
   */
  const CHARACTER_CONFIG = {
    gpt: {
      displayName: 'G哥',
      peerName: 'Cursor',
      ariaDesc: 'G哥的屏幕形象：ChatGPT 白发龙娘 Q版，非官方同人',
      clips: {
        idle: {
          src: 'assets/characters/gpt/idle-blink-square-v1.mp4',
          bg: '#242827',
          scale: 1.18,
          tx: 1.8,
          ty: 1.5,
          start: 4.65,
          end: 9.9,
          restTime: 5.3,
          spec: 'gpt/idle-blink-square-v1.mp4 (720×720 · 截取 4.65s–9.90s 安静眨眼段)',
          note: '使用 720×720 居中裁切版并放大 1.18× 消除底部横切线，保留完整龙角、尖耳与右侧发花，避开大笑段保持待机安静。',
          warn: false
        },
        listening: {
          src: 'assets/characters/gpt/listening-nod.mp4',
          bg: '#343636',
          scale: 1.12,
          tx: -1.4,
          ty: 1.5,
          start: 0,
          end: null,
          restTime: 1.2,
          spec: 'gpt/listening-nod.mp4 (720×720 · 闭嘴点头)',
          note: '倾听状态使用专用点头视频，微调水平偏移 (-1.4%) 与待机眼位对齐，切换无跳变。',
          warn: false
        },
        thinking_calm: {
          src: 'assets/characters/gpt/thinking-question.mp4',
          bg: '#404242',
          scale: 1.12,
          tx: 0,
          ty: 1.5,
          start: 0.0,
          end: 1.18,
          restTime: 0.7,
          spec: 'gpt/thinking-question.mp4 (720×720 · 0.0s–1.18s 无问号安静段)',
          note: '默认截取问号出现前的轻歪头凝思段（符合无符号要求）；可在上方切换查看“保留问号原片”效果。',
          warn: false
        },
        thinking_question: {
          src: 'assets/characters/gpt/thinking-question.mp4',
          bg: '#404242',
          scale: 1.03,
          tx: 2.2,
          ty: 6.2,
          start: 0.0,
          end: 3.96,
          restTime: 2.0,
          spec: 'gpt/thinking-question.mp4 (720×720 · 0.00s–3.96s 中性→歪头问号→复位全循环)',
          note: '用户 10-18 指定保留问号原片：中性姿态起步，歪头浮现问号后复位中性，首尾闭合平滑无突变 (scale 1.03, ty +6.2%)。',
          warn: false
        },
        speaking: {
          src: 'assets/characters/gpt/idle-blink-square-v2.mp4',
          bg: '#242827',
          scale: 1.18,
          tx: 1.8,
          ty: 1.5,
          start: 6.4,
          end: 9.4,
          restTime: 7.55,
          spec: 'gpt/idle-blink-square-v2.mp4 (720×720 · 6.4s–9.4s 开口动作候选段)',
          note: '注意：G哥本批素材缺专用连续说话视频；当前截取 square-v2 中睁眼张闭嘴片段作候选预览，不冒充已验收说话口型。',
          warn: true
        }
      }
    },
    claude: {
      displayName: 'Claude',
      peerName: 'G哥',
      ariaDesc: 'Claude 预览形象：橙黑贝雷帽少女 Q版，非官方同人',
      clips: {
        idle: {
          src: 'assets/characters/claude/idle.mp4',
          bg: '#3f3c37',
          scale: 1.12,
          tx: 0.4,
          ty: 1.2,
          start: 0,
          end: null,
          restTime: 0.5,
          spec: 'claude/idle.mp4 (720×720 · 待机微表情)',
          note: 'Claude 具备完整动作集；放大 1.12× 消除原片内嵌圆盘边线，完整保留贝雷帽与白花头饰。',
          warn: false
        },
        listening: {
          src: 'assets/characters/claude/listening-nod.mp4',
          bg: '#343434',
          scale: 1.12,
          tx: 0,
          ty: 1.2,
          start: 0,
          end: null,
          restTime: 1.2,
          spec: 'claude/listening-nod.mp4 (720×720 · 倾听点头)',
          note: '专用闭嘴点头动作，人物比例与待机完全一致。',
          warn: false
        },
        thinking_calm: {
          src: 'assets/characters/claude/thinking-question.mp4',
          bg: '#3d393a',
          scale: 1.12,
          tx: 0.3,
          ty: 1.2,
          start: 0.0,
          end: 1.18,
          restTime: 0.7,
          spec: 'claude/thinking-question.mp4 (720×720 · 0.0s–1.18s 无问号安静段)',
          note: '默认截取问号出现前的安静凝思段；可在上方切换对比完整带问号原片。',
          warn: false
        },
        thinking_question: {
          src: 'assets/characters/claude/thinking-question.mp4',
          bg: '#3d393a',
          scale: 1.04,
          tx: 1.8,
          ty: 5.5,
          start: 0.0,
          end: 3.96,
          restTime: 2.0,
          spec: 'claude/thinking-question.mp4 (720×720 · 0.00s–3.96s 中性→歪头问号→复位全循环)',
          note: '用户 10-18 指定保留问号原片：中性起步歪头浮现问号后复位中性 (scale 1.04, ty +5.5%)，下移确保问号完整不切边。',
          warn: false
        },
        speaking: {
          src: 'assets/characters/claude/speaking.mp4',
          bg: '#353535',
          scale: 1.12,
          tx: 0.2,
          ty: 1.2,
          start: 0.4,
          end: 3.9,
          restTime: 0.7,
          spec: 'claude/speaking.mp4 (720×720 · 专用连续张闭嘴说话)',
          note: 'Claude 专用说话循环视频，多次自然张闭嘴；视频音轨已静音，实际语音由 TTS 驱动。',
          warn: false
        }
      }
    },
    deepseek: {
      displayName: 'DeepSeek',
      peerName: 'G哥',
      ariaDesc: 'DeepSeek 预览形象：蓝发鲸鱼发饰少女 Q版，非官方同人',
      clips: {
        idle: {
          src: 'assets/characters/deepseek/idle.mp4',
          bg: '#424244',
          scale: 1.09,
          tx: 0.2,
          ty: 1.5,
          start: 0,
          end: null,
          restTime: 0.5,
          spec: 'deepseek/idle.mp4 (720×720 · 待机正视)',
          note: '保留顶部女仆发带、呆毛与左侧小鲸鱼发饰，1.09× 贴合圆屏。',
          warn: false
        },
        listening: {
          src: 'assets/characters/deepseek/listening-nod.mp4',
          bg: '#363638',
          scale: 1.09,
          tx: 0.4,
          ty: 1.5,
          start: 0,
          end: null,
          restTime: 1.0,
          spec: 'deepseek/listening-nod.mp4 (720×720 · 倾听点头)',
          note: '专用倾听点头视频，与待机保持相同头肩比例。',
          warn: false
        },
        thinking_calm: {
          src: 'assets/characters/deepseek/thinking-question.mp4',
          bg: '#404042',
          scale: 1.09,
          tx: 0.2,
          ty: 1.5,
          start: 0.0,
          end: 1.18,
          restTime: 0.68,
          spec: 'deepseek/thinking-question.mp4 (720×720 · 0.0s–1.18s 无问号安静段)',
          note: '使用新增的 DeepSeek 思考视频，默认截取问号出现前的歪头凝思段；可在上方切换对比完整带问号原片。',
          warn: false
        },
        thinking_question: {
          src: 'assets/characters/deepseek/thinking-question.mp4',
          bg: '#404042',
          scale: 1.02,
          tx: -3.5,
          ty: 6.5,
          start: 0.0,
          end: 3.96,
          restTime: 2.02,
          spec: 'deepseek/thinking-question.mp4 (720×720 · 0.00s–3.96s 中性→歪头问号→复位全循环)',
          note: '用户 10-18 指定保留问号原片：中性起步歪头浮现问号后复位中性 (scale 1.02, tx -3.5%, ty +6.5%)，确保问号完整不切边。',
          warn: false
        },
        speaking: {
          src: 'assets/characters/deepseek/speaking.mp4',
          bg: '#3c3c3e',
          scale: 1.09,
          tx: 0,
          ty: 1.5,
          start: 1.8,
          end: 3.9,
          restTime: 2.02,
          spec: 'deepseek/speaking.mp4 (720×720 · 专用连续说话)',
          note: 'DeepSeek 专用连续张闭嘴说话视频；视频原生音轨已静音。',
          warn: false
        }
      }
    }
  };

  const state = {
    phase: 'idle',
    character: 'gpt',
    viewMode: 'dual',
    interactionMode: 'touch',
    thinkingMode: 'question',
    animate: true,
    volume: 60,
    brightness: 85,
    statusDetail: ''
  };

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let sessionSeq = 0;
  let activePointerId = null;
  let activePointerButton = null;
  let keyboardHolding = false;
  let suppressNextClick = false;

  // Blob URL 内存缓存：解决 python3 -m http.server 不支持 HTTP 206 Range 导致 currentTime 跳转归零及重复请求问题
  const blobUrlCache = new Map();
  function resolveMediaUrl(src) {
    if (blobUrlCache.has(src)) {
      return blobUrlCache.get(src);
    }
    // 当页面在 /device/{id}/screen 路径下时，相对路径 assets/ 解析为同源 /device/{id}/screen/assets/
    let fetchUrl = src;
    const screenMatch = location.pathname.match(/^(\/device\/[^/]+\/screen)\/?$/);
    if (screenMatch && src.startsWith('assets/')) {
      fetchUrl = screenMatch[1] + '/' + src;
    } else if (location.pathname.startsWith('/device/') && src.startsWith('assets/')) {
      fetchUrl = location.pathname.replace(/\/+$/, '') + '/screen/' + src;
    }
    const promise = fetch(fetchUrl)
      .then(res => (res.ok ? res.blob() : Promise.reject(new Error('HTTP ' + res.status))))
      .then(blob => URL.createObjectURL(blob))
      .catch(() => fetchUrl);
    blobUrlCache.set(src, promise);
    return promise;
  }

  function shouldAnimate() {
    return state.animate && !motionQuery.matches && !document.hidden && state.phase !== 'offline';
  }

  function resolveClip(characterKey, phase, thinkingMode) {
    const charCfg = CHARACTER_CONFIG[characterKey] || CHARACTER_CONFIG.gpt;
    if (phase === 'listening' || phase === 'peer') {
      return charCfg.clips.listening;
    }
    if (phase === 'thinking') {
      return thinkingMode === 'question' ? charCfg.clips.thinking_question : charCfg.clips.thinking_calm;
    }
    if (phase === 'speaking') {
      return charCfg.clips.speaking;
    }
    return charCfg.clips.idle;
  }

  function phaseCopy(phase, characterKey) {
    const charCfg = CHARACTER_CONFIG[characterKey] || CHARACTER_CONFIG.gpt;
    const peer = charCfg.peerName;
    const detail = state.statusDetail;
    const stopRetryable = typeof voiceState !== 'undefined' && Boolean(voiceState.activeTurn?.stopFailed);
    const table = {
      idle: {
        showChip: Boolean(detail),
        title: detail || '我在',
        action: '按住说话',
        hint: '',
        mode: 'talk',
        disabled: false
      },
      listening: {
        showChip: true,
        title: detail || '正在听你说话',
        action: '松开发送',
        hint: '移开取消',
        mode: 'talk',
        disabled: false
      },
      thinking: {
        showChip: true,
        title: detail || '正在思考…',
        action: '停止本轮',
        hint: '',
        mode: 'stop',
        disabled: false
      },
      speaking: {
        showChip: true,
        title: detail || '正在回答',
        action: '停止回答',
        hint: '',
        mode: 'stop',
        disabled: false
      },
      peer: {
        showChip: true,
        title: detail || ('听 ' + peer + ' 发言'),
        action: '结束讨论',
        hint: '',
        mode: 'stop',
        disabled: false
      },
      busy: {
        showChip: true,
        title: detail || '正在处理任务',
        action: '忙完后继续聊',
        hint: '',
        mode: 'disabled',
        disabled: true
      },
      stopping: {
        showChip: true,
        title: detail || (stopRetryable ? '停止未确认 · 请再按停止' : '已停止 · 正在收尾'),
        action: stopRetryable ? '再按停止' : '等待收尾完成',
        hint: stopRetryable ? '服务端尚未确认停止' : '',
        mode: stopRetryable ? 'stop' : 'disabled',
        disabled: !stopRetryable
      },
      error: {
        showChip: true,
        title: detail || '本轮未完成 · 请重试',
        action: '返回待机',
        hint: '或重新说话',
        mode: 'retry',
        disabled: false
      },
      offline: {
        showChip: true,
        title: detail || '电脑未连接',
        action: '重新连接语音服务',
        hint: '',
        mode: 'settings',
        disabled: false
      }
    };
    return table[phase] || table.idle;
  }

  function enforceSilentVideo(video) {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
  }

  const panelControllers = shells.map(shell => {
    const layers = [...shell.querySelectorAll('.cn-video-layer')];
    layers.forEach(video => {
      enforceSilentVideo(video);
      video.addEventListener('volumechange', () => enforceSilentVideo(video));
      video.addEventListener('play', () => enforceSilentVideo(video));
    });
    return {
      shell,
      layers,
      activeIndex: 0,
      currentLogicalSrc: '',
      clip: null,
      transitionId: 0
    };
  });

  function applyClipTransform(video, clip) {
    video.style.setProperty('--clip-scale', String(clip.scale));
    video.style.setProperty('--clip-tx', clip.tx + '%');
    video.style.setProperty('--clip-ty', clip.ty + '%');
  }

  function syncVideoPlayback(ctrl) {
    const activeVideo = ctrl.layers[ctrl.activeIndex];
    const clip = ctrl.clip;
    if (!activeVideo || !clip) return;
    enforceSilentVideo(activeVideo);

    if (shouldAnimate()) {
      const start = clip.start || 0;
      const end = clip.end;
      if (activeVideo.currentTime < start - 0.05 || (end !== null && activeVideo.currentTime >= end)) {
        try { activeVideo.currentTime = start; } catch {}
      }
      activeVideo.loop = end === null;
      activeVideo.play().catch(() => {});
    } else {
      activeVideo.pause();
      const targetTime = typeof clip.restTime === 'number' ? clip.restTime : (clip.start || 0);
      if (Math.abs((activeVideo.currentTime || 0) - targetTime) > 0.08) {
        try { activeVideo.currentTime = targetTime; } catch {}
      }
    }
  }

  function updatePanelVideo(ctrl, clip) {
    ctrl.clip = clip;
    const screen = ctrl.shell.querySelector('.cn-screen');
    screen.style.setProperty('--cn-screen-bg', clip.bg);
    const activeVideo = ctrl.layers[ctrl.activeIndex];

    if (ctrl.currentLogicalSrc === clip.src && activeVideo.dataset.logicalSrc === clip.src) {
      applyClipTransform(activeVideo, clip);
      syncVideoPlayback(ctrl);
      return;
    }

    const nextIndex = 1 - ctrl.activeIndex;
    const standbyVideo = ctrl.layers[nextIndex];
    const token = ++ctrl.transitionId;

    enforceSilentVideo(standbyVideo);
    applyClipTransform(standbyVideo, clip);
    standbyVideo.loop = clip.end === null;

    resolveMediaUrl(clip.src).then(resolvedUrl => {
      if (token !== ctrl.transitionId) return;

      const commitSwitch = () => {
        if (token !== ctrl.transitionId) return;
        const targetTime = shouldAnimate()
          ? (clip.start || 0)
          : (typeof clip.restTime === 'number' ? clip.restTime : (clip.start || 0));
        try {
          standbyVideo.currentTime = targetTime;
        } catch {}

        standbyVideo.classList.add('is-active');
        standbyVideo.classList.remove('is-standby');
        activeVideo.classList.remove('is-active');
        activeVideo.classList.add('is-standby');

        ctrl.activeIndex = nextIndex;
        ctrl.currentLogicalSrc = clip.src;
        syncVideoPlayback(ctrl);
        setTimeout(() => {
          if (ctrl.activeIndex !== nextIndex) return;
          activeVideo.pause();
        }, 180);
      };

      if (standbyVideo.dataset.logicalSrc !== clip.src || standbyVideo.getAttribute('src') !== resolvedUrl) {
        standbyVideo.dataset.logicalSrc = clip.src;
        standbyVideo.setAttribute('src', resolvedUrl);
        standbyVideo.load();
      }

      if (standbyVideo.readyState >= 2) {
        commitSwitch();
      } else {
        const onReady = () => {
          standbyVideo.removeEventListener('loadeddata', onReady);
          standbyVideo.removeEventListener('canplay', onReady);
          commitSwitch();
        };
        standbyVideo.addEventListener('loadeddata', onReady, { once: true });
        standbyVideo.addEventListener('canplay', onReady, { once: true });
      }
    });
  }

  panelControllers.forEach(ctrl => {
    ctrl.layers.forEach((video, idx) => {
      const clampSegment = () => {
        if (idx !== ctrl.activeIndex || !ctrl.clip) return;
        const { start = 0, end = null, restTime = 0 } = ctrl.clip;
        if (!shouldAnimate()) {
          const target = typeof restTime === 'number' ? restTime : start;
          if (Math.abs((video.currentTime || 0) - target) > 0.08) {
            try { video.currentTime = target; } catch {}
          }
          return;
        }
        if (video.currentTime < start - 0.05 || (end !== null && video.currentTime >= end - 0.04)) {
          try { video.currentTime = start; } catch {}
          video.play().catch(() => {});
        }
      };
      video.addEventListener('loadedmetadata', clampSegment);
      video.addEventListener('loadeddata', clampSegment);
      video.addEventListener('timeupdate', clampSegment);
    });
  });

  const legacyAtlas = root.querySelector('#cn-legacy-atlas');
  const legacyScreen = root.querySelector('#cn-legacy-screen');
  const legacyStatus = root.querySelector('#cn-legacy-status');
  const legacyActionLabel = root.querySelector('#cn-legacy-action-label');
  const legacyActionHint = root.querySelector('#cn-legacy-action-hint');
  const legacyConnText = root.querySelector('#cn-legacy-conn-text');
  const legacyRowMap = {
    idle: 0,
    listening: 6,
    thinking: 8,
    speaking: 3,
    peer: 6,
    busy: 7,
    stopping: 6,
    error: 5,
    offline: 5
  };

  function renderLegacyComparison(copy) {
    if (!legacyAtlas || state.viewMode !== 'compare') return;
    if (!legacyAtlas.getAttribute('src') && legacyAtlas.dataset.legacySrc && !location.pathname.startsWith('/device/')) {
      legacyAtlas.src = legacyAtlas.dataset.legacySrc;
    }
    const row = legacyRowMap[state.phase] ?? 0;
    legacyScreen.dataset.state = state.phase;
    legacyAtlas.style.transform = 'translate(0%, ' + (-row * 100 / 11) + '%)';
    legacyStatus.textContent = copy.title;
    legacyActionLabel.textContent = copy.action;
    legacyActionHint.textContent = copy.hint;
    legacyActionHint.hidden = !copy.hint;
    legacyConnText.textContent = state.phase === 'offline' ? '电脑离线' : '已连接电脑';
  }

  function updateTelemetry() {
    if (!telemetryPhaseEl) return;
    telemetryPhaseEl.textContent = '状态：' + state.phase + (state.statusDetail ? ' (' + state.statusDetail + ')' : '');
    const playerSnapshot = voicePlayer ? voicePlayer.snapshot() : { position: 0, duration: 0 };
    const formatTime = s => {
      const n = Number.isFinite(s) && s >= 0 ? s : 0;
      return Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0');
    };
    telemetryPlaybackEl.textContent = '音频：' + (voiceState.playIntent ? '播放中' : (voicePlayer?.done ? '已播完' : '未播放')) +
      ' (' + formatTime(playerSnapshot.position) + ' / ' + (playerSnapshot.duration ? formatTime(playerSnapshot.duration) : '—') + ')';
    if (voiceState.lastAnswer) {
      telemetryTextEl.textContent = '回答：' + (voiceState.lastAnswer.length > 40 ? voiceState.lastAnswer.slice(0, 40) + '…' : voiceState.lastAnswer);
    } else if (voiceState.lastTranscript) {
      telemetryTextEl.textContent = '识别：' + voiceState.lastTranscript;
    } else {
      telemetryTextEl.textContent = '最近消息：尚无轮次记录';
    }
  }

  function render() {
    const charCfg = CHARACTER_CONFIG[state.character] || CHARACTER_CONFIG.gpt;
    const clip = resolveClip(state.character, state.phase, state.thinkingMode);
    const copy = phaseCopy(state.phase, state.character);

    root.dataset.viewMode = state.viewMode;
    stateSelect.value = state.phase;
    charSelect.value = state.character;
    scaleSelect.value = state.viewMode;
    interactionSelect.value = state.interactionMode;
    thinkingSelect.value = state.thinkingMode;
    motionToggle.checked = state.animate;

    zoomCard.hidden = state.viewMode !== 'dual';
    legacyCard.hidden = state.viewMode !== 'compare';
    primarySizeLabel.textContent = state.viewMode === 'zoom'
      ? '1.35× 放大查看 · 629×629 px'
      : '1:1 硬件实际尺寸 · 466×466 px';

    assetClipEl.textContent = clip.spec + ' · scale(' + clip.scale.toFixed(2) + ')';
    assetNoteEl.textContent = clip.note;
    assetNoteEl.classList.toggle('is-warn', Boolean(clip.warn));

    const brightnessScale = (0.55 + (state.brightness / 100) * 0.45).toFixed(2);

    panelControllers.forEach((ctrl, idx) => {
      if (idx === 1 && state.viewMode !== 'dual') {
        ctrl.layers.forEach(v => v.pause());
        return;
      }
      const device = ctrl.shell.querySelector('.cn-device');
      const screen = ctrl.shell.querySelector('.cn-screen');
      device.style.setProperty('--cn-brightness-filter', brightnessScale);
      screen.dataset.state = state.phase;
      screen.dataset.character = state.character;
      screen.dataset.interaction = state.interactionMode;

      ctrl.shell.querySelector('.cn-character-stage').setAttribute('aria-label', charCfg.ariaDesc);
      ctrl.shell.querySelectorAll('.cn-role-name').forEach(el => {
        el.textContent = voiceState.boundRoleName || charCfg.displayName;
      });

      const topPill = ctrl.shell.querySelector('.cn-top-pill');
      const isOffline = state.phase === 'offline';
      topPill.setAttribute(
        'aria-label',
        (voiceState.boundRoleName || charCfg.displayName) + (isOffline ? '，电脑未连接，打开设备设置' : '，已连接电脑，打开设备设置')
      );
      ctrl.shell.querySelector('.cn-offline-tag').hidden = !isOffline;

      const chip = ctrl.shell.querySelector('.cn-status-chip');
      chip.hidden = !copy.showChip;
      ctrl.shell.querySelector('.cn-title').textContent = copy.title;

      const actionBtn = ctrl.shell.querySelector('.cn-action');
      actionBtn.dataset.mode = copy.mode;
      actionBtn.disabled = copy.disabled;
      actionBtn.setAttribute('aria-label', copy.action + (copy.hint ? '，' + copy.hint : ''));
      ctrl.shell.querySelector('.cn-action-label').textContent = copy.action;
      const hintEl = ctrl.shell.querySelector('.cn-action-hint');
      hintEl.textContent = copy.hint;
      hintEl.hidden = !copy.hint;

      ctrl.shell.querySelector('.cn-volume').value = String(state.volume);
      ctrl.shell.querySelector('.cn-volume-value').textContent = state.volume + '%';
      ctrl.shell.querySelector('.cn-brightness').value = String(state.brightness);
      ctrl.shell.querySelector('.cn-brightness-value').textContent = state.brightness + '%';
      ctrl.shell.querySelector('.cn-settings-connection').textContent = isOffline
        ? '电脑未连接 · 请检查桌面端语音服务与局域网'
        : (voiceState.connected ? '已连接电脑语音后台 (' + (voiceState.config?.device_name || '固定设备') + ') · 视频静音' : '已就绪（事件模式） · 视频音轨已静音');

      updatePanelVideo(ctrl, clip);
    });

    if (voiceAudio) {
      voiceAudio.volume = Math.max(0, Math.min(1, state.volume / 100));
    }
    if (voiceStopBtn) {
      const canRetryStop = state.phase === 'stopping' && Boolean(voiceState.activeTurn?.stopFailed);
      voiceStopBtn.disabled = !(['thinking', 'speaking', 'peer'].includes(state.phase) || canRetryStop);
    }
    updateTelemetry();
    renderLegacyComparison(copy);
  }

  function changePhase(nextPhase, detail = '', saveState = true) {
    if (!VALID_PHASES.includes(nextPhase)) return;
    sessionSeq += 1;
    state.phase = nextPhase;
    state.statusDetail = detail;
    render();
    if (saveState) persistState();
  }

  function toggleSettings(shell, open, moveFocus = true) {
    const settingsEl = shell.querySelector('.cn-settings');
    const wasOpen = !settingsEl.hidden;
    shell.querySelector('.cn-home').hidden = open;
    settingsEl.hidden = !open;
    if (moveFocus && (open || wasOpen)) {
      const focusTarget = open ? shell.querySelector('.cn-back') : shell.querySelector('.cn-top-pill');
      focusTarget?.focus();
    }
  }

  /*
   * ==========================================
   * 真实语音播放器与状态事件驱动核心
   * ==========================================
   */
  class DeviceQueuePlayer {
    constructor(audioEl, { baseURL, onState = () => {}, onProgress = () => {} }) {
      this.audio = audioEl;
      this.baseURL = baseURL;
      this.onState = onState;
      this.onProgress = onProgress;
      this.epoch = 0;
      this.listeners = [];
      this.running = false;
      this.id = null;
    }

    select(turn) {
      this.stop();
      if (!turn) {
        this.id = null;
        return;
      }
      this.id = turn.id;
      this.streaming = Array.isArray(turn.audio_chunks);
      this.chunks = new Map();
      this.next = 0;
      this.elapsed = 0;
      this.current = null;
      this.complete = false;
      this.done = false;
      this.fatal = false;
      this.error = null;
      this.whole = null;
      this.replay = false;
      this.update(turn);
    }

    url(value) {
      if (typeof value !== 'string' || !value) throw new Error('缺少音频地址。');
      const u = new URL(value, this.baseURL);
      return u.href;
    }

    update(turn) {
      if (!turn || turn.id !== this.id || this.fatal) return;
      if (turn.status === 'error') {
        this.fail(new Error(turn.error || '本轮语音合成失败。'), true);
        return;
      }
      try {
        if (this.streaming) {
          for (const chunk of turn.audio_chunks || []) {
            if (!Number.isInteger(chunk.index) || chunk.index < 0 || !Number.isFinite(chunk.duration_seconds) || chunk.duration_seconds <= 0) {
              throw new Error('音频分块索引或时长无效。');
            }
            const item = { index: chunk.index, url: this.url(chunk.audio_url), duration: chunk.duration_seconds };
            const old = this.chunks.get(item.index);
            if (old && (old.url !== item.url || old.duration !== item.duration)) throw new Error('已收到的音频分块发生变化。');
            this.chunks.set(item.index, item);
          }
        }
        if (turn.status === 'ready' && (!this.streaming || turn.audio_complete === true)) {
          this.complete = true;
          if (this.streaming && (!this.chunks.size || [...this.chunks.keys()].some(idx => idx >= this.chunks.size))) {
            throw new Error('语音已结束，但音频分块不完整。');
          }
          if (turn.audio_url) this.whole = this.url(turn.audio_url);
          else if (!this.streaming) throw new Error('本段缺少音频地址。');
        }
        if (this.running) this.pump();
        this.onProgress(this.snapshot());
      } catch (err) {
        this.fail(err, true);
      }
    }

    snapshot() {
      if (!this.id) return { position: 0, duration: 0 };
      const finite = n => Number.isFinite(n) && n >= 0 ? n : 0;
      const total = this.streaming
        ? [...this.chunks.values()].reduce((sum, item) => sum + item.duration, 0)
        : finite(this.audio.duration);
      const position = this.done ? total : this.elapsed + (this.current
        ? Math.min(finite(this.audio.currentTime), this.current.duration || finite(this.audio.duration)) : 0);
      return { position, duration: Math.max(position, total) };
    }

    start({ replay = false } = {}) {
      if (!this.id || this.running || this.fatal) return;
      if (replay || this.done) {
        if (!this.complete || !this.whole) return;
        this.stop();
        this.replay = true;
        this.current = null;
        this.elapsed = 0;
        this.next = 0;
        this.done = false;
      }
      this.running = true;
      if (this.current) this.playItem(this.current, true);
      else this.pump();
    }

    pump() {
      if (!this.running || this.current) return;
      const item = this.streaming && !this.replay ? this.chunks.get(this.next)
        : this.next === 0 && this.whole ? { url: this.whole, duration: 0 } : null;
      if (item) this.playItem(item);
      else if (this.complete && this.next > 0 && (!this.streaming || this.replay || this.next === this.chunks.size)) {
        this.running = false;
        this.done = true;
        this.emit('completed');
      } else {
        this.emit('waiting');
      }
    }

    detach() {
      this.epoch += 1;
      for (const [type, listener] of this.listeners) this.audio.removeEventListener(type, listener);
      this.listeners = [];
    }

    stop() {
      const snap = this.id ? this.snapshot() : { position: 0, duration: 0 };
      this.running = false;
      this.detach();
      try { this.audio.pause(); } catch {}
      return snap;
    }

    emit(stateName, err) {
      this.onState(stateName, this.snapshot(), err);
      this.onProgress(this.snapshot());
    }

    fail(err, fatal = false) {
      this.stop();
      this.fatal = fatal;
      this.error = err;
      this.emit('failed', err);
    }

    playItem(item, resume = false) {
      this.detach();
      this.current = item;
      const currentEpoch = this.epoch;
      const valid = () => this.running && this.epoch === currentEpoch && this.current === item;
      const mediaValid = () => valid() && (this.audio.currentSrc || this.audio.src) === item.url;
      let started = false;
      const listen = (type, cb) => {
        const listener = () => { if (mediaValid()) cb(); };
        this.listeners.push([type, listener]);
        this.audio.addEventListener(type, listener);
      };
      if (!resume || this.audio.error || this.audio.src !== item.url) {
        this.audio.src = item.url;
        try { this.audio.load(); } catch {}
      }
      listen('playing', () => {
        if (this.audio.paused) return;
        started = true;
        this.emit('playing');
      });
      listen('ended', () => {
        if (!started || !this.audio.ended) return;
        this.detach();
        this.elapsed += item.duration || this.snapshot().duration;
        this.next += 1;
        this.current = null;
        this.pump();
      });
      listen('error', () => {
        if (this.audio.error) this.fail(new Error('音频无法加载或解码（' + this.audio.error.code + '）。'));
      });
      listen('pause', () => {
        if (this.audio.paused && !this.audio.ended) { this.stop(); this.emit('paused'); }
      });
      listen('waiting', () => this.emit('buffering'));
      listen('timeupdate', () => this.onProgress(this.snapshot()));
      listen('loadedmetadata', () => this.onProgress(this.snapshot()));
      this.emit('loading');
      if (!valid()) return;
      try {
        Promise.resolve(this.audio.play()).catch(err => { if (valid()) this.fail(err); });
      } catch (err) {
        if (valid()) this.fail(err);
      }
    }
  }

  function randomUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  const deviceClientUUID = randomUuid();
  const voiceState = {
    connected: false,
    connecting: false,
    apiPrefix: '/device/desk-gge',
    token: '',
    config: null,
    defaultRole: 'gge',
    boundRoleName: 'G哥',
    activeTurn: null,
    playerTurn: null,
    playIntent: null,
    lastTranscript: '',
    lastAnswer: '',
    micSession: null,
    audioContext: null
  };

  const VoicePlayerCtor = window.VoiceQueuePlayer || DeviceQueuePlayer;
  const voicePlayer = new VoicePlayerCtor(voiceAudio, {
    baseURL: location.href,
    onState: onVoicePlaybackState,
    onProgress: () => updateTelemetry()
  });

  async function unlockAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && (!voiceState.audioContext || voiceState.audioContext.state === 'closed')) {
      voiceState.audioContext = new AudioCtx();
    }
    if (voiceState.audioContext?.state === 'suspended') {
      await voiceState.audioContext.resume().catch(() => {});
    }
    if (voiceAudio) {
      voiceAudio.play().then(() => voiceAudio.pause()).catch(() => {});
    }
  }

  async function voiceApi(path, options = {}) {
    const { timeout = 25000, ...init } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = new Headers(init.headers);
      if (voiceState.apiPrefix.startsWith('/device/')) {
        headers.set('X-Device-Client', deviceClientUUID);
      }
      if (voiceState.token && init.method && init.method !== 'GET') {
        headers.set('X-Voice-Token', voiceState.token);
      }
      const targetUrl = voiceState.apiPrefix + path;
      const resp = await fetch(targetUrl, {
        ...init,
        headers,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const raw = await resp.text();
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch {
        body = { detail: raw };
      }
      if (!resp.ok) {
        const msg = typeof body.detail === 'string' ? body.detail : ('HTTP ' + resp.status + '：' + JSON.stringify(body.detail ?? body));
        const err = new Error(msg);
        err.status = resp.status;
        throw err;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function connectVoiceService({ apiPrefix = voiceState.apiPrefix, silentIfAbsent = false } = {}) {
    voiceState.apiPrefix = apiPrefix;
    voiceState.connecting = true;
    if (voiceStatusEl) {
      voiceStatusEl.textContent = '正在连接语音服务 (' + (apiPrefix || '/api') + ')…';
      voiceStatusEl.classList.remove('is-error');
    }
    try {
      const cfg = await voiceApi('/api/config');
      if (!Array.isArray(cfg.roles) || !cfg.token) {
        throw new Error('服务返回配置格式不正确。');
      }
      voiceState.connected = true;
      voiceState.connecting = false;
      voiceState.config = cfg;
      voiceState.token = cfg.token;
      voiceState.defaultRole = cfg.default_role || cfg.roles[0]?.id || 'gge';
      const boundRole = cfg.roles.find(r => r.id === voiceState.defaultRole) || cfg.roles[0];
      voiceState.boundRoleName = cfg.device_name || boundRole?.name || 'G哥';

      if (boundRole?.id === 'gge' || boundRole?.id === 'gpt') state.character = 'gpt';
      else if (boundRole?.id === 'claude') state.character = 'claude';
      else if (boundRole?.id === 'deepseek') state.character = 'deepseek';

      if (voiceStatusEl) {
        voiceStatusEl.textContent = '已连接：' + (cfg.device_name || boundRole?.name) + ' (' + (apiPrefix || '/api') + ')';
        voiceStatusEl.classList.remove('is-error');
      }

      if (typeof cfg.active_turn === 'string' && cfg.active_turn) {
        const turn = {
          id: cfg.active_turn,
          project: voiceState.defaultRole,
          restored: true,
          accepted: true,
          reportChain: Promise.resolve()
        };
        voiceState.activeTurn = turn;
        changePhase('thinking', '恢复原轮次…');
        void pollVoiceTurn(turn);
      } else if (cfg.last_release && cfg.last_release.reason === 'lease-expired' && state.phase !== 'idle' && state.phase !== 'offline') {
        const detailText = cfg.last_release.detail || '';
        const reason = detailText ? (detailText.includes('放弃') ? detailText : ('连接中断，本轮已放弃 · ' + detailText)) : '连接中断，本轮已放弃';
        changePhase('error', reason);
      } else if (boundRole?.available === false) {
        changePhase('busy', boundRole.detail || '正在处理另一轮');
      } else if (state.phase === 'offline' || state.phase === 'busy') {
        changePhase('idle', '');
      } else {
        render();
      }
      return true;
    } catch (err) {
      voiceState.connected = false;
      voiceState.connecting = false;
      if (voiceStatusEl) {
        voiceStatusEl.textContent = '连接失败：' + (err.message || '未连接');
        voiceStatusEl.classList.add('is-error');
      }
      if (!silentIfAbsent) {
        changePhase('offline', '电脑未连接 · ' + (err.message || '服务离线'));
      }
      return false;
    }
  }

  function onVoicePlaybackState(playerState, snapshot, error) {
    const intent = voiceState.playIntent;
    if (!intent || !intent.turn) return;
    const turn = intent.turn;
    if (playerState === 'playing') {
      turn.played = true;
      changePhase('speaking', '正在回答');
      if (!intent.reported) {
        intent.reported = true;
        reportVoicePlayback(turn, 'playing', snapshot);
      }
    } else if (playerState === 'completed') {
      turn.completed = true;
      voiceState.playIntent = null;
      if (voiceState.apiPrefix.startsWith('/device/') && voiceState.connected) {
        reportVoicePlayback(turn, 'completed', snapshot);
      } else {
        reportVoicePlayback(turn, 'completed', snapshot);
        changePhase('idle', '');
      }
    } else if (playerState === 'failed') {
      voiceState.playIntent = null;
      if (voiceState.apiPrefix.startsWith('/device/')) {
        reportVoicePlayback(turn, 'failed', snapshot);
      }
      changePhase('error', error?.name === 'NotAllowedError' ? '自动播放被阻止' : (error?.message || '播放失败'));
    } else if (playerState === 'paused') {
      stopVoicePlayback(false);
    }
    updateTelemetry();
  }

  function reportVoicePlayback(turn, pState, snapshot) {
    if (!turn || !turn.id || !voiceState.connected) return;
    const body = JSON.stringify({
      state: pState,
      position_seconds: snapshot.position,
      duration_seconds: snapshot.duration
    });
    turn.reportChain = (turn.reportChain || Promise.resolve()).then(() => voiceApi(
      '/api/turn/' + encodeURIComponent(turn.id) + '/playback',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, timeout: 10000 }
    )).then(() => {
      if (voiceState.apiPrefix.startsWith('/device/') && ['completed', 'failed'].includes(pState)) {
        return awaitDeviceRelease(turn);
      }
    }).catch(() => {
      if (voiceState.apiPrefix.startsWith('/device/') && pState === 'completed') {
        return awaitDeviceRelease(turn);
      }
    });
  }

  function awaitDeviceRelease(turn) {
    if (turn.releaseWait) return turn.releaseWait;
    turn.releaseWait = (async () => {
      for (;;) {
        try {
          const res = await voiceApi('/api/turn/' + encodeURIComponent(turn.id));
          const isAbandoned = Boolean(
            res.abandoned ||
            res.abandon_reason ||
            (res.last_release && res.last_release.reason === 'lease-expired') ||
            (res.status === 'stopped' && (res.error?.includes('放弃') || res.error?.includes('心跳') || res.error?.includes('释放')))
          );
          if (isAbandoned) {
            turn.terminal = true;
            turn.autoplay = false;
            turn.deviceReleased = true;
            turn.abandoned = true;
            stopVoicePlayback(true);
            const detailText = res.abandon_reason || res.last_release?.detail || res.error || '';
            const reason = detailText
              ? (detailText.includes('放弃') ? detailText : ('连接中断，本轮已放弃 · ' + detailText))
              : '连接中断，本轮已放弃';
            turn.abandonReason = reason;
            changePhase('error', reason);
            return;
          }
          if (res.device_released === true) break;
          if (voiceState.activeTurn === turn && state.phase === 'stopping' && !turn.stopFailed) {
            state.statusDetail = '后台正在收尾…';
            render();
          }
        } catch (err) {
          if (err.status === 404 || err.status === 410) break;
          if (voiceState.activeTurn === turn && state.phase === 'stopping' && !turn.stopFailed) {
            state.statusDetail = '等待设备释放确认…';
            render();
          }
        }
        await new Promise(r => setTimeout(r, 350));
      }
      turn.deviceReleased = true;
      turn.stopFailed = false;
      if (voiceState.activeTurn === turn && (state.phase === 'stopping' || (state.phase === 'speaking' && turn.completed))) {
        changePhase('idle', '');
      }
    })();
    return turn.releaseWait;
  }

  function stopVoicePlayback(suppressAutoplay = true) {
    if (suppressAutoplay && voiceState.activeTurn) {
      voiceState.activeTurn.autoplay = false;
    }
    const old = voiceState.playIntent;
    voiceState.playIntent = null;
    const snap = voicePlayer.stop();
    if (old && !voiceState.apiPrefix.startsWith('/device/')) {
      reportVoicePlayback(old.turn, 'stopped', snap);
    }
    updateTelemetry();
  }

  function selectTurnAudio(turn) {
    if (!turn?.audioData) return;
    stopVoicePlayback(false);
    voiceState.playerTurn = turn;
    voicePlayer.select(turn.audioData);
    updateTelemetry();
  }

  function playTurnAudio(turn) {
    if (!turn?.audioData || document.hidden) return;
    const changed = voiceState.playerTurn !== turn;
    if (changed || voicePlayer.fatal) selectTurnAudio(turn);
    else stopVoicePlayback(false);
    if (voicePlayer.fatal) {
      turn.autoplay = false;
      changePhase('error', voicePlayer.error?.message || '音频不可用');
      return;
    }
    turn.autoAttempted = true;
    voiceState.playIntent = { turn, reported: false };
    voicePlayer.start({ replay: Boolean(turn.completed && changed) });
    updateTelemetry();
  }

  function receiveTurnAudio(turn) {
    if (!turn?.audioData) return;
    if (voiceState.playerTurn !== turn && (turn.autoplay || !voiceState.playerTurn)) {
      selectTurnAudio(turn);
    } else if (voiceState.playerTurn === turn) {
      voicePlayer.update(turn.audioData);
    }
    if (voiceState.playerTurn === turn && voicePlayer.fatal) {
      turn.autoplay = false;
      changePhase('error', voicePlayer.error?.message || '音频不可用');
      return;
    }
    if (turn.autoplay && !turn.autoAttempted && !document.hidden) {
      playTurnAudio(turn);
    }
  }

  async function pollVoiceTurn(turn) {
    if (turn.polling || turn.terminal || turn.stopRequested) return;
    turn.polling = true;
    try {
      while (voiceState.activeTurn === turn && !turn.terminal && !turn.stopRequested) {
        const result = await voiceApi('/api/turn/' + encodeURIComponent(turn.id));
        if (voiceState.activeTurn !== turn || turn.stopRequested) return;
        const isAbandoned = Boolean(
          result.abandoned ||
          result.abandon_reason ||
          (result.last_release && result.last_release.reason === 'lease-expired') ||
          (result.status === 'stopped' && (result.error?.includes('放弃') || result.error?.includes('心跳') || result.error?.includes('释放')))
        );
        if (isAbandoned) {
          turn.terminal = true;
          turn.autoplay = false;
          turn.abandoned = true;
          stopVoicePlayback(true);
          const detailText = result.abandon_reason || result.last_release?.detail || result.error || '';
          const reason = detailText
            ? (detailText.includes('放弃') ? detailText : ('连接中断，本轮已放弃 · ' + detailText))
            : '连接中断，本轮已放弃';
          turn.abandonReason = reason;
          changePhase('error', reason);
          return;
        }
        if (voiceState.apiPrefix.startsWith('/device/') && result.status === 'ready'
            && result.playback_allowed !== true) {
          if (result.device_released === true) {
            turn.terminal = true;
            turn.autoplay = false;
            turn.deviceReleased = true;
            changePhase('idle', '本轮已结束');
            return;
          }
          // Synthesis is complete, but another device still owns playback.
          // Do not invent an audio URL or stop polling before the grant arrives.
          if (state.phase !== 'thinking' || state.statusDetail !== '排队等待播放') {
            changePhase('thinking', '排队等待播放', false);
          }
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        if (result.status === 'thinking' || result.status === 'synthesizing') {
          const detail = result.status === 'thinking' ? '正在思考…' : '正在准备声音…';
          if (state.phase === 'thinking') {
            state.statusDetail = detail;
            render();
          }
          if (result.status === 'synthesizing' && typeof result.text === 'string' && result.text.trim()) {
            voiceState.lastAnswer = result.text;
            if (Array.isArray(result.audio_chunks)) {
              turn.audioURL = result.audio_url || (Array.isArray(result.audio_chunks) ? null : voiceState.apiPrefix + '/api/turn/' + encodeURIComponent(turn.id) + '/audio');
              turn.audioData = { ...result, audio_url: turn.audioURL };
              receiveTurnAudio(turn);
            }
          }
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        turn.terminal = true;
        if (typeof result.text === 'string' && result.text.trim()) {
          voiceState.lastAnswer = result.text;
        }
        if (result.status === 'error' || result.status === 'stopped') {
          turn.autoplay = false;
          if (voiceState.playerTurn === turn) voicePlayer.update({ ...result, status: 'error' });
          if (result.status === 'stopped') {
            if (voiceState.apiPrefix.startsWith('/device/')) {
              changePhase('stopping', '已停止 · 正在收尾');
              void awaitDeviceRelease(turn);
            } else {
              changePhase('idle', '');
            }
          } else {
            changePhase('error', result.error || '本轮回答失败');
          }
        } else {
          turn.audioURL = result.audio_url || (Array.isArray(result.audio_chunks) ? null : voiceState.apiPrefix + '/api/turn/' + encodeURIComponent(turn.id) + '/audio');
          turn.audioData = { ...result, audio_url: turn.audioURL };
          receiveTurnAudio(turn);
        }
      }
    } catch (err) {
      if (voiceState.activeTurn !== turn || turn.stopRequested) return;
      if (err.status === 404 || err.status === 410) {
        changePhase('error', '轮次已在服务端结束或回收');
      } else {
        changePhase('offline', '连接中断：' + err.message);
      }
    } finally {
      turn.polling = false;
    }
  }

  async function submitVoiceTurn(text) {
    if (!text || !text.trim()) return false;
    const cleanText = text.trim();
    voiceState.lastTranscript = cleanText;
    stopVoicePlayback(true);
    await unlockAudio();

    if (!voiceState.connected) {
      // 离线/纯事件模式：没有连接语音服务时，由 handleVoiceEvent 或手动触发事件驱动
      changePhase('thinking', '正在思考（事件模式）…');
      return true;
    }

    const turnId = randomUuid();
    const roleId = voiceState.defaultRole;
    const turn = {
      id: turnId,
      project: roleId,
      text: cleanText,
      accepted: false,
      terminal: false,
      autoplay: true,
      reportChain: Promise.resolve()
    };
    voiceState.activeTurn = turn;
    changePhase('thinking', '正在提交消息…');

    try {
      const res = await voiceApi('/api/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: turn.id, project: roleId, text: cleanText })
      });
      if (res.id !== turn.id) throw new Error('轮次编号不匹配。');
      turn.accepted = true;
      if (turn.stopRequested) {
        stopActiveTurn();
        return true;
      }
      state.statusDetail = '正在思考…';
      render();
      void pollVoiceTurn(turn);
      return true;
    } catch (err) {
      if (err.status === 409) {
        changePhase('busy', '服务正忙，本轮未发送');
      } else if (err.status >= 400 && err.status < 500) {
        changePhase('error', err.message || '请求被拒绝');
      } else {
        changePhase('offline', '提交失败：' + err.message);
      }
      return false;
    }
  }

  /* 麦克风录音与 WAV 编码 */
  let micCaptureGeneration = 0;
  function releaseMicSession() {
    micCaptureGeneration += 1;
    const s = voiceState.micSession;
    if (!s) return;
    s.stream?.getTracks().forEach(t => t.stop());
    s.source?.disconnect();
    s.node?.disconnect();
    voiceState.micSession = null;
  }

  async function startMicCapture() {
    releaseMicSession();
    const generation = micCaptureGeneration;
    try {
      await unlockAudio();
      if (generation !== micCaptureGeneration || state.phase !== 'listening') return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false
      });
      // Permission/device startup can finish after pointerup or cancellation.
      // Never attach that late stream to this or a subsequent recording.
      if (generation !== micCaptureGeneration || state.phase !== 'listening') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const ctx = voiceState.audioContext;
      const source = ctx.createMediaStreamSource(stream);
      const session = { stream, source, chunks: [], sampleRate: ctx.sampleRate };
      voiceState.micSession = session;

      const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
      scriptNode.onaudioprocess = ev => {
        if (voiceState.micSession !== session) return;
        const inputData = ev.inputBuffer.getChannelData(0);
        session.chunks.push(new Float32Array(inputData));
      };
      source.connect(scriptNode);
      scriptNode.connect(ctx.destination);
      session.node = scriptNode;
    } catch (err) {
      if (generation !== micCaptureGeneration) return;
      releaseMicSession();
      changePhase('error', err.name === 'NotAllowedError' ? '麦克风权限被拒绝' : ('无法访问麦克风：' + err.message));
    }
  }

  async function makeWavBlob(chunks, actualRate) {
    const count = chunks.reduce((sum, c) => sum + c.length, 0);
    if (!count) throw new Error('没有采集到音频。');
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const length = Math.max(1, Math.floor(count * 16000 / actualRate));
    const offline = new OfflineCtx(1, length, 16000);
    const input = offline.createBuffer(1, count, actualRate);
    let offset = 0;
    for (const c of chunks) { input.copyToChannel(c, 0, offset); offset += c.length; }
    const srcNode = offline.createBufferSource();
    srcNode.buffer = input;
    srcNode.connect(offline.destination);
    srcNode.start();
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);

    const bytes = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(bytes);
    const ascii = (at, str) => [...str].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  async function finishMicCaptureAndTranscribe() {
    const s = voiceState.micSession;
    releaseMicSession();
    if (!s || !s.chunks.length) {
      changePhase('error', '没有采集到音频，请等麦克风就绪后再按住说话');
      return;
    }
    try {
      state.statusDetail = '正在整理录音…';
      render();
      const wav = await makeWavBlob(s.chunks, s.sampleRate);
      state.statusDetail = '正在识别语音…';
      render();
      const res = await voiceApi('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
        timeout: 45000
      });
      if (typeof res.text !== 'string' || !res.text.trim()) {
        throw new Error('未识别到有效语音文字。');
      }
      voiceState.lastTranscript = res.text;
      await submitVoiceTurn(res.text);
    } catch (err) {
      if (err.status === 409) changePhase('busy', '请等当前轮次结束后再录音');
      else changePhase('error', '语音识别未完成：' + (err.message || ''));
    }
  }

  function startListening() {
    if (state.phase !== 'idle' && state.phase !== 'error') return;
    changePhase('listening', '正在听你说话');
    if (voiceState.connected && navigator.mediaDevices?.getUserMedia) {
      void startMicCapture();
    }
  }

  function finishListeningAndThink() {
    if (state.phase !== 'listening') return;
    activePointerId = null;
    activePointerButton = null;
    keyboardHolding = false;
    changePhase('thinking', '正在处理…');
    if (voiceState.connected || voiceState.micSession) {
      void finishMicCaptureAndTranscribe();
    }
  }

  function cancelListening() {
    activePointerId = null;
    activePointerButton = null;
    keyboardHolding = false;
    releaseMicSession();
    if (state.phase === 'listening') {
      changePhase('idle', '');
    }
  }

  function stopActiveTurn() {
    stopVoicePlayback(true);
    const turn = voiceState.activeTurn;
    if (!turn || !voiceState.connected) {
      changePhase('stopping', '已停止 · 正在收尾');
      return;
    }
    turn.stopRequested = true;
    turn.autoplay = false;
    if (!voiceState.apiPrefix.startsWith('/device/')) {
      changePhase('idle', '');
      return;
    }
    if (turn.deviceReleased) {
      changePhase('idle', '');
      return;
    }
    if (turn.releaseWait || turn.stopSent) {
      changePhase('stopping', '后台正在收尾…');
      return;
    }
    if (!turn.accepted && !turn.restored) {
      changePhase('stopping', '已停止 · 正在收尾');
      return;
    }
    turn.stopSent = true;
    turn.stopFailed = false;
    changePhase('stopping', '已停止 · 正在收尾');
    void voiceApi('/api/turn/' + encodeURIComponent(turn.id) + '/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(() => awaitDeviceRelease(turn)).catch(err => {
      if (voiceState.activeTurn !== turn) return;
      turn.stopSent = false;
      turn.stopFailed = true;
      state.phase = 'stopping';
      state.statusDetail = '停止未确认：' + (err?.message || '请求失败') + ' · 请再按停止';
      render();
    });
  }

  function persistState() {
    const payload = {
      phase: state.phase === 'listening' || state.phase === 'thinking' || state.phase === 'speaking' || state.phase === 'stopping' ? 'idle' : state.phase,
      character: state.character,
      viewMode: state.viewMode,
      interactionMode: state.interactionMode,
      thinkingMode: state.thinkingMode,
      animate: state.animate,
      volume: state.volume,
      brightness: state.brightness
    };
    try {
      localStorage.setItem('conest_device_ui_v2', JSON.stringify(payload));
    } catch {}
    if (window.openai?.setWidgetState) {
      window.openai.setWidgetState({
        modelContent: {
          role: CHARACTER_CONFIG[state.character].displayName,
          character: state.character,
          proposal: '共栖 466×466 圆屏推荐方案：高清视频头肩特写 + 真实语音状态驱动'
        },
        privateContent: payload
      }).catch(() => {});
    }
  }

  function restoreState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('conest_device_ui_v2') || 'null');
    } catch {}
    const ext = window.openai?.widgetState?.privateContent;
    const src = ext || saved;
    if (src) {
      if (['idle', 'offline'].includes(src.phase)) {
        state.phase = src.phase;
      }
      if (VALID_CHARS.includes(src.character)) state.character = src.character;
      if (['dual', '466', 'zoom', 'compare'].includes(src.viewMode)) state.viewMode = src.viewMode;
      if (VALID_INTERACTIONS.includes(src.interactionMode)) state.interactionMode = src.interactionMode;
      if (['calm', 'question'].includes(src.thinkingMode)) state.thinkingMode = src.thinkingMode;
      if (typeof src.animate === 'boolean') state.animate = src.animate;
      if (Number.isFinite(src.volume)) state.volume = Math.max(0, Math.min(100, src.volume));
      if (Number.isFinite(src.brightness)) state.brightness = Math.max(35, Math.min(100, src.brightness));
    }
    const backendCfg = window.CONEST_DEVICE_CONFIG || {};
    if (VALID_INTERACTIONS.includes(backendCfg.interactionMode)) {
      state.interactionMode = backendCfg.interactionMode;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const qMode = params.get('interaction') || params.get('button');
      if (VALID_INTERACTIONS.includes(qMode)) {
        state.interactionMode = qMode;
      }
      const qDev = params.get('device') || params.get('api');
      if (qDev) {
        voiceState.apiPrefix = qDev.startsWith('/') ? qDev : ('/device/' + qDev);
        if (voiceEndpointSelect) voiceEndpointSelect.value = voiceState.apiPrefix;
      }
    } catch {}

    let injectedDevice = window.__COQIN_DEVICE__;
    if (!injectedDevice) {
      const jsonEl = document.getElementById('__coqin_device__');
      if (jsonEl?.textContent) {
        try { injectedDevice = JSON.parse(jsonEl.textContent); } catch {}
      }
    }
    if (!injectedDevice) {
      const metaApi = document.querySelector('meta[name="coqin-device-api"]')?.getAttribute('content');
      const metaId = document.querySelector('meta[name="coqin-device-id"]')?.getAttribute('content');
      if (metaApi || metaId) {
        injectedDevice = { api: metaApi, id: metaId };
      }
    }
    if (injectedDevice && typeof injectedDevice === 'object') {
      if (typeof injectedDevice.api === 'string' && injectedDevice.api) {
        voiceState.apiPrefix = injectedDevice.api.replace(/\/$/, '');
      } else if (typeof injectedDevice.id === 'string' && injectedDevice.id) {
        voiceState.apiPrefix = '/device/' + injectedDevice.id;
      }
      if (voiceEndpointSelect) voiceEndpointSelect.value = voiceState.apiPrefix;
    }

    const deviceMatch = location.pathname.match(/^(\/device\/[^/]+)(?:\/screen(?:\/.*)?)?$/);
    if (deviceMatch) {
      voiceState.apiPrefix = deviceMatch[1];
      if (voiceEndpointSelect) voiceEndpointSelect.value = voiceState.apiPrefix;
    }
  }

  shells.forEach(shell => {
    const actionBtn = shell.querySelector('.cn-action');
    const topPill = shell.querySelector('.cn-top-pill');
    const backBtn = shell.querySelector('.cn-back');
    const volInput = shell.querySelector('.cn-volume');
    const briInput = shell.querySelector('.cn-brightness');

    topPill.addEventListener('click', () => {
      if (state.interactionMode === 'hidden') return;
      if (state.phase === 'listening') cancelListening();
      toggleSettings(shell, true, true);
    });

    backBtn.addEventListener('click', () => {
      toggleSettings(shell, false, true);
    });

    actionBtn.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (state.phase === 'error') {
        changePhase('idle', '');
        return;
      }
      if (state.phase !== 'idle') return;
      event.preventDefault();
      activePointerId = event.pointerId;
      activePointerButton = actionBtn;
      try { actionBtn.setPointerCapture(activePointerId); } catch {}
      startListening();
    });

    actionBtn.addEventListener('pointerup', event => {
      if (event.pointerId !== activePointerId) return;
      const pid = activePointerId;
      finishListeningAndThink();
      suppressNextClick = true;
      try {
        if (actionBtn.hasPointerCapture(pid)) actionBtn.releasePointerCapture(pid);
      } catch {}
    });

    actionBtn.addEventListener('pointercancel', cancelListening);
    actionBtn.addEventListener('lostpointercapture', () => {
      if (activePointerId !== null) cancelListening();
    });

    actionBtn.addEventListener('keydown', event => {
      if (![' ', 'Enter'].includes(event.key) || event.repeat) return;
      if (state.phase === 'error') {
        changePhase('idle', '');
        return;
      }
      if (state.phase !== 'idle') return;
      event.preventDefault();
      keyboardHolding = true;
      activePointerButton = actionBtn;
      startListening();
    });

    actionBtn.addEventListener('keyup', event => {
      if (keyboardHolding && [' ', 'Enter'].includes(event.key)) {
        event.preventDefault();
        finishListeningAndThink();
      }
    });

    actionBtn.addEventListener('blur', () => {
      if (keyboardHolding && activePointerButton === actionBtn) {
        cancelListening();
      }
    });

    actionBtn.addEventListener('click', event => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      if (state.phase === 'error') {
        changePhase('idle', '');
        return;
      }
      if (state.phase === 'offline') {
        void connectVoiceService({ apiPrefix: voiceState.apiPrefix, silentIfAbsent: false });
        return;
      }
      if (['thinking', 'speaking', 'peer'].includes(state.phase) || (state.phase === 'stopping' && voiceState.activeTurn?.stopFailed)) {
        stopActiveTurn();
      }
    });

    volInput.addEventListener('input', event => {
      state.volume = Number(event.target.value);
      render();
      persistState();
    });

    briInput.addEventListener('input', event => {
      state.brightness = Number(event.target.value);
      render();
      persistState();
    });
  });

  stateSelect.addEventListener('change', event => {
    activePointerId = null;
    activePointerButton = null;
    keyboardHolding = false;
    suppressNextClick = false;
    shells.forEach(s => toggleSettings(s, false, false));
    changePhase(event.target.value, '');
  });

  charSelect.addEventListener('change', event => {
    state.character = event.target.value;
    render();
    persistState();
  });

  scaleSelect.addEventListener('change', event => {
    state.viewMode = event.target.value;
    render();
    persistState();
  });

  interactionSelect.addEventListener('change', event => {
    if (!VALID_INTERACTIONS.includes(event.target.value)) return;
    state.interactionMode = event.target.value;
    if (state.interactionMode === 'hidden') {
      shells.forEach(s => toggleSettings(s, false, false));
    }
    render();
    persistState();
  });

  thinkingSelect.addEventListener('change', event => {
    state.thinkingMode = event.target.value;
    render();
    persistState();
  });

  motionToggle.addEventListener('change', event => {
    state.animate = event.target.checked;
    render();
    panelControllers.forEach(syncVideoPlayback);
    persistState();
  });

  if (voiceEndpointSelect) {
    voiceEndpointSelect.addEventListener('change', event => {
      voiceState.apiPrefix = event.target.value;
      void connectVoiceService({ apiPrefix: voiceState.apiPrefix, silentIfAbsent: false });
    });
  }

  if (voiceConnectBtn) {
    voiceConnectBtn.addEventListener('click', () => {
      void connectVoiceService({ apiPrefix: voiceState.apiPrefix, silentIfAbsent: false });
    });
  }

  if (voiceForm) {
    voiceForm.addEventListener('submit', event => {
      event.preventDefault();
      const txt = voiceTextInput?.value?.trim();
      if (!txt) return;
      voiceTextInput.value = '';
      void submitVoiceTurn(txt);
    });
  }

  if (voiceStopBtn) {
    voiceStopBtn.addEventListener('click', () => {
      stopActiveTurn();
    });
  }

  window.addEventListener('blur', cancelListening);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelListening();
    }
    panelControllers.forEach(syncVideoPlayback);
  });
  motionQuery.addEventListener('change', () => {
    panelControllers.forEach(syncVideoPlayback);
  });

  // 全局暴露驱动接口供外部自动化测试、iframe、跨页面桥接与扩展调用
  window.__conestDeviceUI = {
    getState: () => ({
      ...state,
      sessionSeq,
      connected: voiceState.connected,
      apiPrefix: voiceState.apiPrefix,
      activeTurnId: voiceState.activeTurn?.id || null,
      stopFailed: Boolean(voiceState.activeTurn?.stopFailed),
      deviceReleased: Boolean(voiceState.activeTurn?.deviceReleased),
      abandoned: Boolean(voiceState.activeTurn?.abandoned),
      abandonReason: voiceState.activeTurn?.abandonReason || '',
      lastTranscript: voiceState.lastTranscript,
      lastAnswer: voiceState.lastAnswer
    }),
    setInteractionMode: mode => {
      if (!VALID_INTERACTIONS.includes(mode)) return false;
      state.interactionMode = mode;
      if (mode === 'hidden') {
        shells.forEach(s => toggleSettings(s, false, false));
      }
      render();
      persistState();
      return true;
    },
    connectVoice: (options = {}) => connectVoiceService(options),
    submitTextTurn: text => submitVoiceTurn(text),
    stopActiveTurn: () => stopActiveTurn(),
    handleVoiceEvent: event => {
      if (!event || typeof event.type !== 'string') return false;
      switch (event.type) {
        case 'recording:start':
          changePhase('listening', event.detail || '正在听你说话');
          break;
        case 'recording:stop':
        case 'transcribe:start':
        case 'turn:submitted':
          changePhase('thinking', event.detail || '正在处理…');
          break;
        case 'recording:cancel':
          changePhase('idle', '');
          break;
        case 'turn:abandoned':
        case 'turn:expired':
          if (voiceState.activeTurn) {
            voiceState.activeTurn.terminal = true;
            voiceState.activeTurn.autoplay = false;
            voiceState.activeTurn.abandoned = true;
            voiceState.activeTurn.abandonReason = event.detail || event.reason || '连接中断，本轮已放弃';
          }
          stopVoicePlayback(true);
          changePhase('error', event.detail || event.reason || '连接中断，本轮已放弃');
          break;
        case 'turn:status':
          if (event.status === 'thinking' || event.status === 'synthesizing') {
            changePhase('thinking', event.detail || (event.status === 'thinking' ? '正在思考…' : '正在准备声音…'));
          } else if (event.status === 'error') {
            changePhase('error', event.error || '本轮回答失败');
          } else if (event.status === 'stopped') {
            changePhase('stopping', '已停止 · 正在收尾');
          }
          break;
        case 'audio:playing':
        case 'playback:state':
          if (event.type === 'audio:playing' || event.state === 'playing') {
            changePhase('speaking', event.detail || '正在回答');
          } else if (event.state === 'completed') {
            changePhase('idle', '');
          } else if (event.state === 'failed') {
            changePhase('error', event.error || '播放失败');
          } else if (event.state === 'stopped') {
            changePhase('idle', '');
          }
          break;
        case 'audio:ended':
          changePhase('idle', '');
          break;
        case 'turn:stop':
          changePhase('stopping', event.detail || '已停止 · 正在收尾');
          break;
        case 'turn:stopped':
          changePhase('idle', '');
          break;
        case 'turn:busy':
          changePhase('busy', event.detail || '正在处理任务');
          break;
        case 'turn:error':
          changePhase('error', event.error || '本轮回答失败');
          break;
        case 'connection:offline':
          changePhase('offline', event.detail || '电脑未连接');
          break;
        case 'connection:online':
          if (state.phase === 'offline') changePhase('idle', '');
          break;
        case 'peer:speaking':
          changePhase('peer', event.detail || ('听 ' + (event.peerName || '同伴') + ' 发言'));
          break;
        default:
          return false;
      }
      return true;
    },
    // 保留向后兼容的竞态防回跳测试接口
    simulateLateSpeakingCallback: capturedSeq => {
      if (capturedSeq !== sessionSeq || state.phase !== 'thinking') {
        return false;
      }
      changePhase('speaking', '正在回答');
      return true;
    }
  };

  restoreState();
  render();
  // 静默探测并自动尝试连接同源/本地语音接口
  void connectVoiceService({ apiPrefix: voiceState.apiPrefix, silentIfAbsent: true });
})();
