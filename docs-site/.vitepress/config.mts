import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'bothouse 文档',
  description: '把你电脑上的 AI 拉进聊天群，组成会自己分活的小队',
  base: '/bothouse/',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/bothouse/img/logo.svg' }]],
  themeConfig: {
    logo: '/img/logo.svg',
    siteTitle: 'bothouse',
    nav: [
      { text: '新手教程', link: '/guide/choose' },
      { text: '它是怎么工作的', link: '/how-it-works' },
      { text: '常见卡点', link: '/troubleshooting' },
      { text: '下载', link: 'https://github.com/zuiho-kai/bothouse/releases' },
    ],
    sidebar: [
      { text: '首页', link: '/' },
      { text: '它是怎么工作的', link: '/how-it-works' },
      {
        text: '新手教程',
        items: [
          { text: '先选一条路', link: '/guide/choose' },
          { text: '开始前：装 bothouse', link: '/guide/install' },
          { text: '路线 A：DSH 桌面版（推荐第一次）', link: '/guide/dsh' },
          { text: '路线 B：Discord', link: '/guide/discord' },
          { text: '路线 C：QQ（施工中）', link: '/guide/qq' },
          { text: '装好之后：第一天能干什么', link: '/guide/first-day' },
        ],
      },
      { text: '常见卡点', link: '/troubleshooting' },
      {
        text: '进阶',
        collapsed: true,
        items: [
          { text: '关掉窗口也一直在线', link: '/advanced/always-online' },
          { text: '谁能指挥它', link: '/advanced/who-can-command' },
          { text: '关掉每小时自动发言', link: '/advanced/hourly-chat' },
          { text: '改名字和性格', link: '/advanced/persona' },
          { text: '团队记忆', link: '/advanced/memory' },
          { text: '换模型', link: '/advanced/model' },
        ],
      },
      { text: '名词对照', link: '/glossary' },
      { text: '给开发者', link: '/dev/' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/zuiho-kai/bothouse' }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: { noResultsText: '没找到', resetButtonTitle: '清除', footer: { selectText: '打开', navigateText: '切换', closeText: '关闭' } },
        },
      },
    },
    editLink: { pattern: 'https://github.com/zuiho-kai/bothouse/edit/develop/docs-site/:path', text: '这页写错了？在 GitHub 上改' },
    outline: { label: '本页内容', level: [2, 3] },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '深色模式',
    footer: { message: 'Apache-2.0 开源', copyright: 'bothouse' },
  },
})
