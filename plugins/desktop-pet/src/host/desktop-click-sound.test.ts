import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const sprite = readFileSync(new URL('../../runtime/electron-helper/sprite.js', import.meta.url), 'utf8');

function fixture(base: string, enabled: boolean | undefined = true, failure?: 'construct' | 'play' | 'reject') {
  let now = 1000;
  const sounds: Array<{ url: string; plays: number; currentTime: number; volume: number }> = [];
  const config: { clickSoundEnabled: boolean | undefined } = { clickSoundEnabled: enabled };
  const controls = runInNewContext(sprite + '\n({ play: playClickSound })', {
    BASE: base,
    ORIGIN: 'http://127.0.0.1:3080',
    config,
    navigator: { platform: 'Win32' },
    Date: { now: () => now },
    Audio: class {
      url: string;
      plays = 0;
      currentTime = 10;
      volume = 1;
      constructor(url: string) {
        this.url = url;
        if (failure === 'construct') throw new Error('audio unavailable');
        sounds.push(this);
      }
      play() {
        this.plays++;
        if (failure === 'play') throw new Error('play unavailable');
        return failure === 'reject' ? Promise.reject(new Error('autoplay rejected')) : Promise.resolve();
      }
    },
  }) as { play(): void };
  return {
    ...controls,
    sounds,
    config,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('desktop click sound uses the bridge asset channel in bridge mode', () => {
  const audio = fixture('dsh-pet-bridge://dsh-pet/dsh-pet-7340');
  audio.play();
  assert.equal(audio.sounds[0].url, 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/sound/click-duck.wav');
});

test('desktop click sound retains direct HTTP in legacy mode', () => {
  const audio = fixture('http://127.0.0.1:3080/dsh-pet-7340');
  audio.play();
  assert.equal(audio.sounds[0].url, 'http://127.0.0.1:3080/dsh-pet-7340/sound/click-duck.wav');
});

test('disabled or absent click-sound settings never create an audio request', () => {
  const audio = fixture('dsh-pet-bridge://dsh-pet/dsh-pet-7340', false);
  audio.play();
  audio.config.clickSoundEnabled = undefined;
  audio.advance(100);
  audio.play();
  assert.equal(audio.sounds.length, 0);
});

test('click sound reuses its audio element and throttles rapid clicks', () => {
  const audio = fixture('dsh-pet-bridge://dsh-pet/dsh-pet-7340');
  audio.play();
  audio.advance(99);
  audio.play();
  assert.equal(audio.sounds[0].plays, 1);
  audio.advance(1);
  audio.play();
  assert.equal(audio.sounds.length, 1);
  assert.equal(audio.sounds[0].plays, 2);
  assert.equal(audio.sounds[0].currentTime, 0);
  assert.equal(audio.sounds[0].volume, 0.5);
});

for (const failure of ['construct', 'play', 'reject'] as const) {
  test(`audio ${failure} failures do not escape the click handler`, async () => {
    const audio = fixture('dsh-pet-bridge://dsh-pet/dsh-pet-7340', true, failure);
    assert.doesNotThrow(audio.play);
    await setImmediate();
  });
}
