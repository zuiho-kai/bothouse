import { openDSHWeb } from '@/api/wizard';

// Go to the DSH channels page, starting `dsh web` first when it is not running (after a reboot, or
// when its window was closed) — otherwise the page only answers 503. Same wait as the setup
// wizard's 打开 DSH: no deadline while it is still starting. On an error the page itself explains.
export async function goToDsh(url: string, onWait?: (sec: number) => void): Promise<void> {
  try {
    for (let w = await openDSHWeb(); w.starting; w = await openDSHWeb()) {
      onWait?.(w.elapsed_sec ?? 0);
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch { /* fall through: the /dsh/ page says what is wrong */ }
  window.location.href = url;
}
