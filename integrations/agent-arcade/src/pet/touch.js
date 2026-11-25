// Shared by the portrait and the model so local pokes produce the same
// cross-body reaction and expire on the same schedule.
export const touchSeconds = Object.freeze({poke: 1.4, pat: 1.6, huff: 2.6});

export function registerPoke(recent, seconds) {
  while (recent.length && seconds - recent[0] >= 4) recent.shift();
  recent.push(seconds);
  if (recent.length < 3) return 'poke';
  recent.length = 0;
  return 'huff';
}
