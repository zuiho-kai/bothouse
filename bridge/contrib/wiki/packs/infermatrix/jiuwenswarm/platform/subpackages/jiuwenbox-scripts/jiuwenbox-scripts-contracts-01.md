---
name: jiuwenbox-scripts-contracts-01
description: jiuwenbox-scripts 源码接口 01：jiuwenbox/scripts/build_docker.sh（docker build）与 run_docker.sh（docker run）两个脚本的执行边界
metadata:
  scope: 只收 build_docker.sh 与 run_docker.sh 两个文件的记录；目录入口归 jiuwenbox-scripts-overview
---
# jiuwenbox-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenbox/scripts/build_docker.sh`**
- 脚本执行边界：`docker build -f "$PROJECT_DIR/docker/Dockerfile" -t "$IMAGE_REF" "$PROJECT_DIR" "$@"`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/scripts/build_docker.sh#L1-L26)。
- **`jiuwenbox/scripts/run_docker.sh`**
- 脚本执行边界：`docker run -itd \`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/scripts/run_docker.sh#L1-L241)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/subpackages/jiuwenbox-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
