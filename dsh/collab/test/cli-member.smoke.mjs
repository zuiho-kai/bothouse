// 冒烟：用本机 claude 走 ACP 真问一句话
import { createCliMember } from '../cli-member.mjs'
const m = createCliMember({ cli: 'claude', cwd: process.cwd(), persona: '你是群聊成员，回答控制在一句话。' })
const reply = await m.ask('用一句话介绍你自己', 'smoke-room')
console.log('REPLY:', reply)
const again = await m.ask('我刚才让你做什么？一句话回答', 'smoke-room')
console.log('REPLY2:', again)
m.close()
if (!reply.trim()) process.exit(1)
