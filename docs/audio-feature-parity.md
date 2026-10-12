# 旧版音频功能保留与重构映射

> 2026-10-12：真实运行补验已完成，当前发布版本为 3.0.4。TTS、RVC 一键翻唱/分离/换声、610.5 秒实时测试和 NSIS 安装的实际证据，以及原参考音频删除后的资料缺项，见 `docs/release/2026-10-12-mutsumi-audio-studio-3.0.4-verification.md`。本文下面的早期“未运行”记录保留为历史。

来源：启动重构前核对的 `VoicePanel.tsx`、`RvcWorkbench.tsx`、`NcmBatchConverter.tsx`、`electron/main.ts`、`preload.ts`、`ipc.ts` 与 `smartchat_rvc_worker.py`。本清单用于新实现逐项验收；实现过程中须勾选并补录真实测试的证据。

下方复选标记代表实现已接入，不等同于真实模型推理、录音或虚拟线路端到端验收。验证记录见本文末尾。

## GPT-SoVITS 文字配音

- [x] `/set_gpt_weights` 切换 GPT `.ckpt`、`/set_sovits_weights` 切换 SoVITS `.pth`、`/tts` JSON 提交，参考音频路径、参考文本/语言、合成语言、语速、采样步数、切分方法、片段间隔。
- [x] 现有内置角色表与分组，包括 Mujica、MyGO、Poppin'Party、刺团等分组角色，参考音频可能缺失；用户可新增、删除、编辑角色资料。
- [x] 当前输入文本、播放/暂停/停止、生成后自动播放、选择导出文件夹、以 wav 保存、文件名消毒及同名不覆盖。
- [x] 修正真实切分方法映射：cut0 不切、cut1 四句、cut2 约50字、cut3 中文句号、cut4 英文句号、cut5 标点。
- [x] 模型文件路径/参考音频可验证并清楚报告；启动状态准确；生成落盘和作品记录可靠。

## RVC + UVR + FFmpeg 翻唱工作台

- [x] 输入音频；根目录扫描与附加模型目录；扫描模型 `.pth`、`.index`、UVR 模型；输出目录；刷新扫描。
- [x] 保留完整流程、一键NCM翻唱混音、单独分离人声、单独分离伴奏、独立换声、独立混音五种动作。
- [x] 所有参数：说话人ID、变调、F0、索引比例、滤波半径、重采样率、音量包络、无声保护、UVR聚合、输出格式、伴奏/人声音量、UVR模型。
- [x] WAV/FLAC/MP3 导出；人声、伴奏、换声结果和混音结果可选为下步输入；输出命名与不覆盖。
- [x] 进度、阶段、日志、队列、取消、结果播放；NCM一键转换到换声音轨。
- [x] 取消不匹配时选取第一个 index 的规则；阶段产物、任务快照、错误重试、持久化和可靠取消。

## NCM 与基础服务

- [x] 扫描目录/选择单文件、全选、多选、取消选择、批量解密转换、逐项成功/错误汇报。
- [x] 现有 GPT-SoVITS API tray helper：检查/启动、重启、停止及日志。
- [x] 引擎路径、解释器、FFmpeg、端口改为可配置；健康检查；RVC离线与实时使用有界GPU调度。

## 新增功能

- [x] RVC 实时麦克风转换，耳机试听或虚拟设备输出到其他软件，显式启停、模型/设备状态、遥测、可选录制、设备失败恢复。
- [x] 持久任务队列和作品库，TTS → RVC、NCM → RVC、两轨 → 独立混音。
- [x] 若叶睦浅色和Mortis深色主题与逐项生成美术资源。

## 静态确认

- 现有 TTS API 地址硬编码为 `http://127.0.0.1:9880`。
- 角色目录变更检测会删除 `tts_characters`，不能继续沿用。
- RVC 模型索引自动匹配失败会选取第一个候选索引，不能继续沿用。
- RVC 事件流按单个 chunk 分行解析，需支持跨 chunk UTF-8/JSON。
- 当前没有真正持久化的 RVC 任务队列。
- 基线 `npx tsc --noEmit` 与 `npm run build` 已通过；此项仅记录旧版，不作为新版本验收。

## 本轮验证记录

- `npm run typecheck`：通过（包含音频工作台、受限 IPC、FFmpeg 选择与实时变声适配器）。
- `npm run build`：通过；electron-vite 构建主进程、preload、renderer 与两套主题插画。
- RVC Python：已安装 `sounddevice 0.4.7`；通过 UTF-8 环境执行 `realtime_worker.py --devices`，列出本机 MME、DirectSound、WASAPI、WDM-KS 端点；另通过 RVC `Config` / `tools.rvc_for_realtime` / torch / torchaudio 的导入检查。没有开启麦克风流。
- RVC 只读资源核对：模型 `weights/tomori_boukaru.pth`、`indices/tomori_boukaru.index`、`assets/hubert/hubert_base.pt`、`assets/rmvpe.pt` 和 RVC 环境内 FFmpeg 均存在。尚未执行真实 RVC 转换或实时模型推理。
- GPT-SoVITS：本机 `127.0.0.1:9880` 当前拒绝连接；本轮未启动模型 API，尚未执行真实 TTS 合成。
- 最终 2.0.1 Windows 安装包与 ZIP 的路径、大小、SHA256 和打包内容检查记录见 `docs/release/2026-09-23-mutsumi-audio-studio-2.0.1-verification.md`；SHA256 清单随发布文件提供。
