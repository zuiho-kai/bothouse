import React from 'react';
import { Badge, Card } from '@/components/ui';
import { Sparkles, Heart, Award, ArrowRight } from 'lucide-react';
import type { BothousePlugin } from '../pluginInterface';

export const personalityPlugin: BothousePlugin = {
  id: 'personality-nurture',
  name: '人格养成 (待接入)',
  author: 'community / 第三方开源贡献者',
  repo: 'https://github.com/bothouse-plugins/personality-nurture-demo',
  license: 'MIT',
  version: 'v0.1.0-preview',
  description: '第三方插件接入示例：通过统一角色事件接口订阅 working/celebrate/speech 事件，随任务完成度积累角色经验与好感度羁绊。',
  subscriptions: ['working', 'celebrate', 'speech'],
  enabled: false,
  status: 'pending',
  render: ({ events, roles }) => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ink">人格养成与好感度系统 (待接入占位)</h3>
            <Badge variant="warning" className="text-xs">
              状态：待第三方作者接入实现
            </Badge>
          </div>
          <span className="text-xs text-ink-mute">
            示意第三方开源插件如何挂入统一插件接口
          </span>
        </div>

        <div className="rounded-card border border-hairline bg-surface p-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl space-y-2">
              <div className="flex items-center gap-2 text-accent">
                <Sparkles size={18} />
                <span className="font-semibold text-sm">统一接口事件订阅示例</span>
              </div>
              <h4 className="text-lg font-bold text-ink">
                第三方插件如何与 bothouse 角色事件协同？
              </h4>
              <p className="text-xs text-ink-soft leading-relaxed">
                本卡片为插件规范占位：任何作者的开源插件只需实现 <code>BothousePlugin</code> 接口，声明所订阅的角色事件（如交活庆祝 <code>celebrate</code> 增加好感、干活中 <code>working</code> 增加专注经验），插件总页即可自动注册、管理开关、并在该区域挂载渲染！
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-xl bg-surface-sunken p-4 min-w-[280px]">
              <div className="flex items-center justify-between text-xs font-medium text-ink">
                <span className="flex items-center gap-1.5">
                  <Heart size={14} className="text-pink-500 fill-pink-500" />
                  当前全员好感羁绊
                </span>
                <span className="font-mono text-accent">Lv.3 (340/500)</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
                <div className="h-full bg-gradient-to-r from-pink-500 to-accent w-[68%]" />
              </div>

              <div className="flex items-center justify-between text-[11px] text-ink-soft pt-1 border-t border-hairline">
                <span>最近事件捕获</span>
                <Badge variant="outline" className="text-[10px]">
                  {Object.values(events)[0]?.type || '待触发'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Roles Affinity Preview Grid */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {roles.map((r) => {
              const ev = events[r.name];
              return (
                <div key={r.name} className="rounded-lg border border-hairline bg-surface-sunken/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink">{r.display_name || r.name}</span>
                    <span className="text-[10px] text-ink-mute">羁绊值 95%</span>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-soft truncate">
                    收到事件：{ev?.type || '待机'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
};
