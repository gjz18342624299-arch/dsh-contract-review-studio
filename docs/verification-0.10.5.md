# 0.10.5 公开版本与验证记录（2026-11-10）

公开 0.10.5 在 0.10.4 的固定 SDK 安全修复、原配色侧栏短竖线和回稿／版本功能基础上统一版本标识。运行代码基线为 [e9fdc8ab8bd288f876b4cb350c1b262d268ebe67](https://github.com/gjz18342624299-arch/dsh-contract-review-studio/commit/e9fdc8ab8bd288f876b4cb350c1b262d268ebe67)；本次运行文件的变化仅为包版本、客户端注册版本和页面版本文字，未新增业务功能。精确公开提交与打包校验值记录在 [PR #75 正文](https://github.com/dataelement/awesome-dsh-workbench/pull/75)。

## 分发与数据

- `package.json`、客户端注册、页面标签及 README 当前版本统一为 **0.10.5**。
- 公开初始项目、合同、企业模板与规则仍为空；不包含作者本机材料、服务地址或凭据。
- 本机 `0.10.5-local-sidebar` 是另一个含本机材料的私有安装。版本号对齐不表示安装包或数据相同；其材料、文件及截图不作为公开包内容或公开版原生实测证据。
- 安装来源仍为 GitHub 源码，仓库已有交付文件；可用 `npm pack --ignore-scripts` 打包，无市场代跑构建、npm 发布或 Release 附件。

## 源码检查

- `npm test`：8/8 安全回归通过。
- 两段 HTML 内联脚本及客户端 JavaScript 语法检查通过。
- 与公开 0.10.4 基线比较，运行文件仅有上述三个版本标识变化；固定 SDK、安全边界、空白数据和存储命名空间未改变。
- 固定 ONLYOFFICE SDK SHA-256 仍为 `b8a6dfe7560aaa8a6ae1b75d857ea6e71d2b7880d684e4c1b2ca69870a65c32d`；来源与许可见 [provenance](onlyoffice-sdk-provenance.json)。

## Desktop 环境与仍待补齐的证据

只读确认的环境为 **DSH Desktop 0.13.2（文件版本 0.13.2.0）、Windows 10 家庭版 10.0.19045、x64**。这不是公开 0.10.5 的原生安装或编辑验收结果。

**公开 0.10.5 尚未完成原生 Desktop 重新安装、实际 Word 编辑和新版原生窗口实拍。** 当前正式 Desktop 固定默认用户目录和普通 Harness profile，并使用单实例锁；只读核对未找到可确认安全、可与现有私有安装并存的原生测试 profile。没有替换默认数据目录、覆盖私有安装或改写官方 Desktop 包来补测。

完整原生补测需在独立 Windows 用户或虚拟机中，从 PR 正文记录的精确公开 0.10.5 提交安装；使用合成 DOCX 验证打开、编辑、保存和重新打开核对正文，并提供带 Desktop 窗口边框的安装、工作区及编辑实拍。完成后再补结果，不以独立浏览器测试代替原生窗口证据。

README 和目录现有两张截图仍为 0.10.3 合成材料的独立 Chromium 客户端截图，**不是 0.10.5 或原生 Desktop 实拍**。历史来源见 [0.10.3 验证记录](verification-0.10.3.md)；0.10.4 的侧栏与验证范围见 [0.10.4 记录](verification-0.10.4.md)。

本轮未验证完整原生会话创建／恢复、完整卸载后的保留行为、macOS 或 Linux。安全回归、Catalog CI、人工审核、合并和市场发布分别确认；PR 保持草稿，未宣称审核通过或上架。
