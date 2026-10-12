import type { VoiceProfile } from '../../shared/contracts'

/**
 * 内置 GPT-SoVITS 角色档案。
 *
 * 本仓库**不内置任何角色档案**：模型权重与参考音频属于第三方资源，
 * 既不随代码分发，也不包含任何作者本机的路径。首次运行时列表为空，
 * 请到「声音库」自行添加角色（GPT / SoVITS 权重、参考音频与参考文本）。
 */
export const BUILTIN_VOICES: VoiceProfile[] = []
