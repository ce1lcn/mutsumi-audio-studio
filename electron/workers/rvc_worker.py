"""睦音工坊 RVC 离线任务 worker。

由主进程以 `python rvc_worker.py <json>` 启动，工作目录为 RVC 根目录。
stdout 每行输出一个 JSON 事件：
  {"type": "progress", "progress": 0-100, "stage": "..."}
  {"type": "log", "message": "..."}
  {"type": "outputs", "outputs": {"vocal": path, "instrument": path, "converted": path, "mixed": path}}
  {"type": "done"} / {"type": "error", "message": "..."}
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

AUDIO_FORMATS = {"wav", "flac", "mp3"}


def emit(event_type, **values):
    print(json.dumps({"type": event_type, **values}, ensure_ascii=False), flush=True)


def progress(value, stage):
    emit("progress", progress=value, stage=stage)


def log(message):
    emit("log", message=str(message))


def sanitize(name):
    invalid = '<>:"/\\|?*\x00'
    cleaned = "".join("_" if ch in invalid else ch for ch in name).strip(". ")
    return cleaned[:120] or "音频"


def unique_path(directory, filename):
    path = Path(directory) / filename
    if not path.exists():
        return path
    for counter in range(2, 1000):
        candidate = path.with_name(f"{path.stem} ({counter}){path.suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{path.stem}-{int(time.time())}{path.suffix}")


def find_ffmpeg(rvc_root, configured):
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_file():
            raise FileNotFoundError(f"设置中的 FFmpeg 不存在：{candidate}")
        return str(candidate.resolve())
    for candidate in (
        Path(sys.executable).parent / "ffmpeg.exe",
        Path(rvc_root) / "rvc_env" / "Scripts" / "ffmpeg.exe",
        Path(rvc_root) / "runtime" / "ffmpeg.exe",
        Path(rvc_root) / "ffmpeg.exe",
    ):
        if candidate.is_file():
            return str(candidate)
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise FileNotFoundError("找不到 FFmpeg。请在“设置”中选择 ffmpeg.exe，或将其加入 PATH。")


def run_ffmpeg(ffmpeg, args):
    result = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip()[-600:]
        raise RuntimeError(f"FFmpeg 处理失败：{detail}")


def setup_environment(opts):
    root = Path(opts["rvcRoot"]).resolve()
    os.chdir(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    os.environ.setdefault("weight_root", "assets/weights/")
    os.environ.setdefault("index_root", "logs/")
    # 不同版本的 RVC 把 rmvpe.pt 放在 assets/rmvpe/ 或 assets/ 下
    rmvpe_dir = next((d for d in (root / "assets" / "rmvpe", root / "assets") if (d / "rmvpe.pt").is_file()), root / "assets")
    os.environ["rmvpe_root"] = str(rmvpe_dir)
    os.environ.setdefault("hubert_root", "assets/hubert")
    # UVR 内部通过 PATH 调用 ffmpeg / ffprobe
    ffmpeg_dir = str(Path(opts["ffmpegPath"]).parent)
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")


def resolve_uvr_model(opts):
    name = opts.get("uvrModel") or "HP5_only_main_vocal"
    root = Path(opts["rvcRoot"])
    for directory in (root / "weights" / "uvr5", root / "assets" / "uvr5_weights"):
        if (directory / f"{name}.pth").is_file() or (directory / name).is_dir():
            return name, directory
    raise FileNotFoundError(f"找不到 UVR 模型：{name}")


def separate(opts, work_dir, outputs, base_name, span):
    """UVR 分离人声与伴奏。span 为该阶段在总进度中的区间。"""
    from infer.modules.uvr5.modules import uvr
    import soundfile as sf

    start, end = span
    ffmpeg = opts["ffmpegPath"]
    model_name, model_dir = resolve_uvr_model(opts)
    os.environ["weight_uvr5_root"] = str(model_dir)
    progress(start, "准备分离音频")

    stage_dir = Path(tempfile.mkdtemp(prefix="stage-", dir=work_dir))
    out_dir = Path(tempfile.mkdtemp(prefix="uvr-", dir=work_dir))
    try:
        # 预先衰减一半，给上游 int16 输出留余量；分离后最多补偿两倍。
        staged = stage_dir / "input.wav"
        run_ffmpeg(ffmpeg, ["-i", opts["inputPath"], "-vn", "-af", "volume=0.5", "-ac", "2", "-ar", "44100", str(staged)])
        log(f"使用 {model_name} 分离人声与伴奏")
        progress(start + 3, "正在分离人声与伴奏")
        messages = []
        for message in uvr(model_name, str(stage_dir), str(out_dir), [], str(out_dir),
                           int(opts["params"].get("uvrAggression", 10)), "wav"):
            text = str(message).strip()
            if text:
                messages.append(text)
        vocal = next(iter(sorted(out_dir.glob("vocal_*"))), None)
        instrument = next(iter(sorted(out_dir.glob("instrument_*"))), None)
        if not vocal or not instrument:
            detail = "\n".join(messages[-3:])[-800:] or "UVR 没有输出信息"
            raise RuntimeError(f"UVR 没有生成人声/伴奏文件：{detail}")

        progress(end - 4, "恢复分离后音量")
        fmt = opts["params"].get("outputFormat", "wav")
        for key, source, label in (("vocal", vocal, "人声"), ("instrument", instrument, "伴奏")):
            target = unique_path(work_dir, f"{base_name} - {label}.{fmt}")
            peak = 0.0
            for block in sf.blocks(str(source), blocksize=65536, dtype="float32", always_2d=True):
                if block.size:
                    peak = max(peak, float(abs(block).max()))
            gain = min(2.0, 0.98 / peak) if peak else 2.0
            if gain < 2.0:
                log(f"{label}已保留峰值余量，音量补偿为 {gain:.3f} 倍，避免导出削波")
            run_ffmpeg(ffmpeg, ["-i", str(source), "-af", f"volume={gain:.8f}", str(target)])
            outputs[key] = str(target)
        progress(end, "分离完成")
        emit("outputs", outputs=outputs)
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)


def convert(opts, work_dir, outputs, base_name, span):
    """RVC 换声。"""
    from configs.config import Config
    from infer.modules.vc.modules import VC
    import soundfile as sf

    start, end = span
    params = opts["params"]
    source = outputs.get("vocal") or opts["inputPath"]
    if not source or not Path(source).is_file():
        raise FileNotFoundError(f"找不到要换声的人声文件：{source}")
    model_path = Path(opts["modelPath"])
    if not model_path.is_file():
        raise FileNotFoundError(f"找不到 RVC 模型：{model_path}")
    index_path = opts.get("indexPath") or ""

    progress(start, "加载声音模型")
    os.environ["weight_root"] = str(model_path.parent) + os.sep
    vc = VC(Config())
    vc.get_vc(model_path.name)
    progress(start + (end - start) // 4, "正在转换人声")
    message, result = vc.vc_single(
        int(params.get("speakerId", 0)), source, int(params.get("pitch", 0)), None,
        params.get("f0Method", "rmvpe"), index_path, index_path,
        float(params.get("indexRate", 0.75)), int(params.get("filterRadius", 3)),
        int(params.get("resampleRate", 0)), float(params.get("volumeEnvelope", 0.25)),
        float(params.get("protect", 0.33)),
    )
    log(message)
    if not result or result[1] is None:
        raise RuntimeError(f"RVC 转换失败：{message}")
    sample_rate, audio = result
    fmt = params.get("outputFormat", "wav")
    target = unique_path(work_dir, f"{base_name} - 换声.{fmt}")
    if fmt == "wav":
        sf.write(str(target), audio, sample_rate)
    else:
        temporary = unique_path(work_dir, f"{base_name} - 换声.tmp.wav")
        sf.write(str(temporary), audio, sample_rate)
        try:
            run_ffmpeg(opts["ffmpegPath"], ["-i", str(temporary), str(target)])
        finally:
            temporary.unlink(missing_ok=True)
    if not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError("RVC 转换没有生成文件")
    outputs["converted"] = str(target)
    progress(end, "换声完成")
    emit("outputs", outputs=outputs)


def mix(opts, work_dir, outputs, base_name, span):
    """伴奏 + 人声混音。"""
    start, end = span
    params = opts["params"]
    instrument = outputs.get("instrument") or opts.get("instrumentPath")
    vocal = outputs.get("converted") or opts.get("vocalPath")
    for label, path in (("伴奏", instrument), ("人声", vocal)):
        if not path or not Path(path).is_file():
            raise FileNotFoundError(f"找不到用于混音的{label}文件：{path}")
    progress(start, "正在混音")
    fmt = params.get("outputFormat", "wav")
    target = unique_path(work_dir, f"{base_name} - 混音.{fmt}")
    bg = float(params.get("backgroundVolume", 0.7))
    vo = float(params.get("vocalVolume", 1.2))
    run_ffmpeg(opts["ffmpegPath"], [
        "-i", instrument, "-i", vocal,
        "-filter_complex", f"[0:a]volume={bg}[bg];[1:a]volume={vo}[vo];[bg][vo]amix=inputs=2:duration=first[out]",
        "-map", "[out]", str(target),
    ])
    if not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError("混音没有生成文件")
    outputs["mixed"] = str(target)
    progress(end, "混音完成")
    emit("outputs", outputs=outputs)


def main():
    opts = json.loads(sys.argv[1])
    # RVC 的配置模块在导入时解析 argv，这里清掉任务参数
    sys.argv = [sys.argv[0]]
    outputs = {}
    try:
        opts["ffmpegPath"] = find_ffmpeg(opts["rvcRoot"], opts.get("ffmpegPath", ""))
        setup_environment(opts)
        fmt = str(opts["params"].get("outputFormat", "wav")).lower()
        opts["params"]["outputFormat"] = fmt if fmt in AUDIO_FORMATS else "wav"
        work_dir = Path(opts["outputDir"])
        work_dir.mkdir(parents=True, exist_ok=True)
        source_name = Path(opts.get("inputPath") or opts.get("vocalPath") or "音频").stem
        model_name = Path(opts["modelPath"]).stem if opts.get("modelPath") else ""
        base_name = sanitize(f"{source_name} - {model_name}" if model_name else source_name)

        action = opts["action"]
        if action == "full":
            separate(opts, work_dir, outputs, base_name, (2, 40))
            convert(opts, work_dir, outputs, base_name, (42, 88))
            mix(opts, work_dir, outputs, base_name, (90, 99))
        elif action == "separate":
            separate(opts, work_dir, outputs, base_name, (2, 99))
        elif action == "convert":
            convert(opts, work_dir, outputs, base_name, (2, 99))
        elif action == "mix":
            mix(opts, work_dir, outputs, base_name, (2, 99))
        else:
            raise ValueError(f"未知任务类型：{action}")
        emit("done", outputs=outputs)
        return 0
    except Exception as error:
        emit("error", message=str(error), detail=traceback.format_exc()[-2000:], outputs=outputs)
        return 1


if __name__ == "__main__":
    sys.exit(main())
