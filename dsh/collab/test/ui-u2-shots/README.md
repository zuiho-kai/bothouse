# 频道页验收截图（U2）

根目录是改后的 `dsh/collab/page.html`，`before/` 是同一页面在 `origin/develop` 上的改前版本。
两套都由同一份 mock 数据、同一套无头 Chrome 视口渲染，只替换页面文件，便于逐像素对照。

| 文件 | 视口 | 场景 |
| --- | --- | --- |
| `desktop-dark.png` / `desktop-light.png` | 1280×800 | 三栏、消息分组、四种任务卡状态 |
| `mobile-closed.png` | 390×844 暗 | 窄屏默认态，两侧收回抽屉 |
| `mobile-light-closed.png` | 390×844 亮 | 同上，亮色 |
| `mobile-rooms.png` | 390×844 暗 | 频道抽屉展开 + 遮罩 |
| `mobile-members-light.png` | 390×844 亮 | 成员抽屉展开 + 遮罩 |
| `empty-light.png` | 900×700 亮 | 空态 |
| `error-light.png` | 900×700 亮 | 错态（原因 + 重试） |

改前只有 `before/` 下四张（桌面与手机的亮/暗默认态）；改前的窄屏没有抽屉，两侧栏挤在 390px 里。

页面通过无头 Chrome 的 CDP 驱动渲染并断言，检查项与结果写在对应 PR 正文；断言覆盖横向溢出、抽屉开合与遮罩、消息分组、任务卡状态色、空/错态、44px 点按目标、亮暗对比度与 `prefers-reduced-motion`。