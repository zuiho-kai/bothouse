import DefaultTheme from 'vitepress/theme'
import { onMounted } from 'vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  setup() {
    onMounted(() => {
      // 正文里的截图点一下在新窗口看原图
      document.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        if (t && t.tagName === 'IMG' && t.closest('.vp-doc') && !t.closest('a')) {
          window.open((t as HTMLImageElement).src, '_blank')
        }
      })
    })
  },
}
