# 8796 伴侣圆屏服务验收清单与运维指南

- **服务地址**：`http://127.0.0.1:8796`
- **主要圆屏入口**：[http://127.0.0.1:8796/device/desk-gge/screen/](http://127.0.0.1:8796/device/desk-gge/screen/)
- **备用普通设备页**：[http://127.0.0.1:8796/device/desk-gge](http://127.0.0.1:8796/device/desk-gge)
- **运行实例目录**：`~/.cc-connect-maomao/voice/device-preview-20261017-140039/`
- **服务实时日志**：`~/.cc-connect-maomao/voice/device-preview-20261017-140039/server.log`
- **当前发布版本**：`decef9be`（已集成 PR #73 设备发言权拆分与 PR #70 问号思考动画无缝全循环）

---

## 一、自动化只读冒烟自检（验收前 10 秒快速验证）

在开始真人语音交互前，可在终端执行项目内置的只读冒烟脚本：

```bash
python3 companion/tools/smoke_device.py --instance-dir <实例目录> --releases-dir <发布根目录>
```

两个目录是这台机器上 8796 部署的实例目录和发布根目录，没有默认值；也可以用环境变量 `CONEST_DEVICE_INSTANCE_DIR`、`CONEST_DEVICE_RELEASES_DIR` 给。

### 预期输出
- 所有页面（首页、普通设备页、圆屏 HTML、`screen.css`、`screen.js`）与 `/api/devices` 均返回 **HTTP 200**；
- 校验 `release-source.json` 与部署记录匹配，并确认部署记录里的 pid 仍是存活的 `voice.device_server`、工作目录就是该发布目录；
- 脚本不创建对话轮次、不提交录音；唯一的轻微副作用是 `/api/config` 会为固定探针客户端登记一条租约（不占轮次，自行过期）。全部通过时输出 `15 PASSED, 0 FAILED`。

---

## 二、真人全流程验收步骤清单

请按照以下 6 个标准阶段逐步体验并核对：

```
① 打开圆屏 ──> ② 按住说话 ──> ③ 原会话接续 ──> ④ 音频播放 ──> ⑤ 主动停止 ──> ⑥ 失败与恢复
```

---

### 第 1 步：打开圆屏（初始化与待机）

1. **操作**：
   - 用 Chrome / Safari 打开 [http://127.0.0.1:8796/device/desk-gge/screen/](http://127.0.0.1:8796/device/desk-gge/screen/)。
2. **正常预期表现**：
   - 居中呈现 466×466 圆形 AMOLED 黑底屏幕容器与圆屏边框；
   - 角色为 **G哥（白龙）**，初始状态处于 **`idle`（待机）**；
   - 画面中 G哥 安静注视并平稳眨眼（无横向切边，龙角与发饰完整）；
   - 屏幕下方状态胶囊显示「**待机中**」，底部主按钮文案为「**按住说话**」；
   - 浏览器开发者工具控制台（F12）零报错、零 CSP 拦截。
3. **若异常排查（看 `server.log`）**：
   - 打开日志检索：
     ```bash
     tail -n 30 ~/.cc-connect-maomao/voice/device-preview-20261017-140039/server.log
     ```
   - 正常日志行应包含：
     ```text
     "GET /device/desk-gge/screen/ HTTP/1.1" 200 OK
     "GET /device/desk-gge/screen/__coqin_device.js HTTP/1.1" 200 OK
     "GET /device/desk-gge/screen/screen/screen.js HTTP/1.1" 200 OK
     ```
   - 若连接被拒绝（Connection Refused）：检查 8796 端口进程是否存活：
     ```bash
     lsof -i :8796
     ```

---

### 第 2 步：按住说话（麦克风录音与识别）

1. **操作**：
   - 鼠标左键按住（或触摸屏按住）主操作按钮（或长按空格键）；
   - 对着麦克风说一句话（例如：“*G哥，早安！今天我们要推进什么任务？*”）；
   - 说完后松开按键。
2. **正常预期表现**：
   - **按下时**：画面立即切为 **`listening`（倾听）** 状态，G哥低头点头倾听，声波光环扩散浮动；按钮文案变为「**松开发送**」，右上角录音计时器实时走字（0.0s / 30s）；
   - **松开时**：录音立刻结束，按钮变为「**正在思考…**」，状态切为 **`thinking`（思考）**。
3. **若异常排查（看 `server.log`）**：
   - 正常松开后日志应记录音频上传并返回 200：
     ```text
     "POST /device/desk-gge/api/transcribe HTTP/1.1" 200 OK
     ```
   - **若显示 409 Conflict**：说明此设备上一轮收尾尚未释放，或同一台设备有并发录音；
   - **若浏览器提示麦克风未授权**：需在浏览器地址栏左侧锁形图标允许麦克风访问权限；
   - **若显示 413**：说明录音超过 30 秒硬上限，请缩短语音单次时长。

---

### 第 3 步：原会话接续（思考动画与会话关联）

1. **操作**：
   - 观察松开后的思考阶段，无需任何点击，静待后端生成。
2. **正常预期表现**：
   - **思考动画**：进入 **`thinking`** 状态，播放 PR #70 定稿的歪头思考全循环原片（`中性立正无问号 → 歪头 → 问号浮现晃动 → 问号淡出 → 回正中性立正`，0.00s–3.96s 闭环，首尾接缝无跳帧）；
   - **防假思考**：页面没有 1.5s 伪装计时器，会真实等待后端完成大模型推理与语音合成；
   - **接续原会话**：后台将语音送入绑定的真实会话（`session_key: discord:...`），G哥 的回答会带有上下文记忆，而非新开空白对话。
3. **若异常排查（看 `server.log`）**：
   - 正常提交与状态轮询日志：
     ```text
     "POST /device/desk-gge/api/turn HTTP/1.1" 202 Accepted
     "GET /device/desk-gge/api/turn/<turn_id> HTTP/1.1" 200 OK
     ```
   - 若出现 `409 Conflict`（文案提示管线繁忙）：说明另一台设备当前正在占用单路生成管线，待其生成结束后自动接纳；
   - 若出现错误：轮询返回 `{"status": "error"}`，进入第 6 步重试分支。

---

### 第 4 步：音频播放（TTS 发声与说话口型）

1. **操作**：
   - 倾听耳机/扬声器中播放的 G哥 合成语音。
2. **正常预期表现**：
   - 回答生成完成后，圆屏自动切入 **`speaking`（说话）** 状态；
   - G哥 大头切换为自然张闭嘴说话动画，声波律动扩散；
   - 主按钮显示「**再按停止**」；
   - 声音播完后，页面自动恢复到 **`idle`（待机）**，G哥 恢复安静呼吸。
3. **若异常排查（看 `server.log`）**：
   - 正常音频拉取与播放回执日志：
     ```text
     "GET /device/desk-gge/api/audio/<turn_id> HTTP/1.1" 200 OK
     "POST /device/desk-gge/api/turn/<turn_id>/playback HTTP/1.1" 200 OK
     ```
   - 若画面在说话但没有声音：检查电脑系统音量输出，或浏览器音频标签是否被系统静音。

---

### 第 5 步：主动停止（打断与平稳收尾）

1. **操作**：
   - 在 G哥 说话（或思考）过程中，主动点击一次主操作按钮（「**再按停止**」）。
2. **正常预期表现**：
   - 声音瞬间静音切断；
   - 状态立即进入 **`stopping`（收尾中）**，按钮显示「**等待收尾完成**」并暂时禁用，杜绝用户连击引发竞态；
   - 后端异步释放本设备占用并回收播放槽；
   - 释放确认后，平稳回归 **`idle`（待机）**，按钮重新变为「**按住说话**」。
3. **若异常排查（看 `server.log`）**：
   - 正常停止请求日志：
     ```text
     "POST /device/desk-gge/api/turn/<turn_id>/stop HTTP/1.1" 200 OK
     ```
   - 若停止异常：页面不会发生 350ms 闪烁回退，按钮会保持在 stopping 状态并支持再次重试。

---

### 第 6 步：失败提示与容错恢复

1. **模拟测试场景**：
   - **离线提示**：拔掉网线或断开 Wi-Fi（或临时模拟失联），页面顶部显示网络警示，按钮切换为禁用提示；恢复后自动重连并回归 `idle`。
   - **轮次失败**：若因上游大模型超限或 Bridge 抖动导致轮次失败，页面进入 **`error`** 状态，按钮显示「**重试**」，点击重试可清除错误并重新开放麦克风。
2. **若异常排查（看 `server.log`）**：
   - 日志中排查关键字：
     ```bash
     grep -E "500|ERROR|turn:error" ~/.cc-connect-maomao/voice/device-preview-20261017-140039/server.log
     ```

---

## 三、快速回滚方案（备忘）

若现场出现不可恢复的异常，可一键回滚到上一稳定版本：

```bash
# 1. 查找并终止当前 8796 进程
kill $(lsof -t -i :8796)

# 2. 从上一发布目录 (d8cda33a) 重启服务
cd ~/.cc-connect-maomao/voice/releases/d8cda33a*/companion
/opt/homebrew/bin/python3 -m voice.device_server \
  --config ~/.cc-connect-maomao/voice/device-preview-20261017-140039/config.json \
  --roles ~/.cc-connect-maomao/voice/device-preview-20261017-140039/roles.json \
  --devices ~/.cc-connect-maomao/voice/device-preview-20261017-140039/devices.json &
```
