import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

/**
 * 列表进场：容器内带 data-entrance 的元素依次淡入并上升 20px。
 * 间隔 70ms、位移 20px、时长 0.42s 取自 taste-skill 的 Move 章（60–90ms、16–32px 的入场）；
 * 减少动态效果时只淡入、不位移。
 * 只在挂载时跑一次：筛选重排不重复播，免得列表一直在动。
 */
export function useEntrance<T extends HTMLElement>() {
  const scope = useRef<T>(null);

  useGSAP(
    () => {
      const items = gsap.utils.toArray<HTMLElement>('[data-entrance]');
      if (!items.length) return;

      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(items, {
          y: 20,
          opacity: 0,
          duration: 0.42,
          ease: 'power2.out',
          stagger: 0.07,
          clearProps: 'transform,opacity',
        });
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.from(items, { opacity: 0, duration: 0.2, ease: 'none', stagger: 0.03, clearProps: 'opacity' });
      });

      return () => mm.revert();
    },
    { scope }
  );

  return scope;
}