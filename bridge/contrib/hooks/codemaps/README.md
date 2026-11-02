# 代码地图目录（codemaps）

bothouse 的 codemap-inject hook 在派子 agent（Agent/Task）时，按派活说明里的词从这个目录选地图，
在 prompt 前加一句「先读地图、交付附地图要补的条目」；子 agent 交付后，codemap-fill hook 把它交付里
「## 地图要补的条目（<地图路径>）」一节的条目追加到那张地图末尾。目录可用环境变量 CODEMAP_DIR 换掉。

一张地图就是这里的一个 .md，写某个代码库的入口、关键符号和 文件:行，例如：

    ---
    name: my-repo-codemap
    keywords: my-repo, 网关, 路由, router
    ---
    # my-repo 代码地图
    - 请求入口 handleRequest server/http.go:42

选图规则：去掉派活说明里的路径和网址后，命中至少 2 个不同的 keywords 才附上；keywords 只写 1 个词的命中 1 个即可。
本文件没有 keywords 行，不会被选中。
