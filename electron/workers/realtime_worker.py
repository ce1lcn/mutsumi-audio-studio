"""Headless streaming adapter for the checked-out RVC realtime inference code.

Audio buffers stay inside Python/PortAudio. The process boundary carries only
small JSON control and telemetry messages.
"""

import argparse
import json
import os
import queue
import sys
import threading
import time
import traceback
from pathlib import Path


def write_event(kind, **values):
    print(json.dumps({"type": kind, **values}, ensure_ascii=False), flush=True)


def list_devices():
    import sounddevice as sd

    hostapis = sd.query_hostapis()
    host_names = [item["name"] for item in hostapis]
    result = []
    for index, device in enumerate(sd.query_devices()):
        host_index = int(device["hostapi"])
        host = hostapis[host_index] if host_index < len(hostapis) else {}
        result.append({
            "id": f"{host_index}:{index}",
            "name": str(device["name"]),
            "hostApi": host_names[host_index] if host_index < len(host_names) else "Unknown",
            "inputChannels": int(device["max_input_channels"]),
            "outputChannels": int(device["max_output_channels"]),
            "defaultSampleRate": int(device["default_samplerate"]),
            # 该驱动下的系统默认录音/播放设备
            "isDefaultInput": host.get("default_input_device") == index,
            "isDefaultOutput": host.get("default_output_device") == index,
        })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--devices", action="store_true")
    parser.add_argument("--config")
    args = parser.parse_args()

    # RVC/Fairseq and some torch utilities inspect argv while importing.
    sys.argv = [sys.argv[0]]
    try:
        import sounddevice as sd
    except Exception as error:
        if args.devices:
            print(json.dumps({"error": f"实时音频依赖 sounddevice 不可用：{error}"}, ensure_ascii=False))
            return 2
        write_event("error", message=f"实时音频依赖 sounddevice 不可用：{error}")
        return 2

    if args.devices:
        try:
            print(json.dumps({"devices": list_devices()}, ensure_ascii=False))
            return 0
        except Exception as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False))
            return 2

    try:
        options = json.loads(args.config or "{}")
    except json.JSONDecodeError as error:
        write_event("error", message=f"实时配置格式无效：{error}")
        return 2

    root = Path(options.get("rvcRoot", "")).resolve()
    model_path = Path(options.get("modelPath", "")).resolve()
    index_path = Path(options.get("indexPath", "")).resolve() if options.get("indexPath") else None
    if not root.is_dir():
        write_event("error", message=f"RVC 根目录不存在：{root}")
        return 2
    if not model_path.is_file() or model_path.suffix.lower() != ".pth":
        write_event("error", message=f"请选择有效的 RVC .pth 模型：{model_path}")
        return 2
    if index_path and (not index_path.is_file() or index_path.suffix.lower() != ".index"):
        write_event("error", message=f"索引文件无效：{index_path}")
        return 2

    os.chdir(root)
    sys.path.insert(0, str(root))
    os.environ.setdefault("weight_root", str(model_path.parent) + os.sep)
    os.environ.setdefault("index_root", str(index_path.parent if index_path else root / "indices") + os.sep)
    os.environ.setdefault("rmvpe_root", str(root / "assets") + os.sep)
    os.environ.setdefault("hubert_root", str(root / "assets") + os.sep)
    os.environ.setdefault("OMP_NUM_THREADS", "4")

    # Keep upstream diagnostic output away from the structured event stream.
    try:
        from configs.config import Config
        from tools import rvc_for_realtime
        import torch
        import torchaudio.transforms as audio_transforms
        import numpy as np
    except Exception as error:
        write_event("error", message=f"无法加载 RVC 实时推理依赖：{error}", detail=traceback.format_exc())
        return 2

    try:
        input_host_id, input_id = parse_device_id(options.get("inputDeviceId"))
        output_host_id, output_id = parse_device_id(options.get("outputDeviceId"))
        sample_rate = int(options.get("sampleRate", 48000))
        block_seconds = float(options.get("blockSeconds", 0.2))
        crossfade_seconds = float(options.get("crossfadeSeconds", 0.04))
        extra_seconds = float(options.get("extraSeconds", 2.0))
        f0_method = str(options.get("f0Method", "rmvpe"))
        if f0_method not in {"rmvpe", "pm", "harvest", "crepe"}:
            raise ValueError("F0 方法无效")
        if sample_rate < 16000 or sample_rate > 96000:
            raise ValueError("采样率必须在 16000 到 96000 Hz 之间")
        if not 0.08 <= block_seconds <= 0.5:
            raise ValueError("块时长必须在 0.08 到 0.5 秒之间")

        input_device = sd.query_devices(input_id)
        output_device = sd.query_devices(output_id)
        if int(input_device["hostapi"]) != input_host_id or int(output_device["hostapi"]) != output_host_id:
            raise ValueError("音频设备列表已变化，请重新扫描并选择设备")
        if input_device["max_input_channels"] < 1:
            raise ValueError("所选输入设备没有录音通道")
        if output_device["max_output_channels"] < 1:
            raise ValueError("所选输出设备没有播放通道")
        channels = 1
        sd.check_input_settings(device=input_id, channels=1, samplerate=sample_rate, dtype="float32")
        sd.check_output_settings(device=output_id, channels=1, samplerate=sample_rate, dtype="float32")

        config = Config()
        n_cpu = 1  # Avoid child F0 workers; stream lifetime is owned by this process.
        rvc = rvc_for_realtime.RVC(
            int(options.get("pitch", 0)), str(model_path), str(index_path or ""),
            float(options.get("indexRate", 0.75 if index_path else 0)), n_cpu,
            None, None, config,
        )
        if not hasattr(rvc, "net_g") or not hasattr(rvc, "tgt_sr"):
            raise RuntimeError("RVC 模型初始化失败，请查看实时变声日志和模型文件")

        zc = sample_rate // 100
        block_frame = max(zc, int(round(block_seconds * sample_rate / zc)) * zc)
        block_frame_16k = 160 * block_frame // zc
        crossfade_frame = max(zc, int(round(crossfade_seconds * sample_rate / zc)) * zc)
        search_frame = zc
        extra_frame = int(round(extra_seconds * sample_rate / zc)) * zc
        sola_frame = min(crossfade_frame, 4 * zc)
        return_length = (block_frame + sola_frame + search_frame) // zc
        skip_head = extra_frame // zc
        input_wav = torch.zeros(extra_frame + crossfade_frame + search_frame + block_frame, device=config.device)
        resampled_history = torch.zeros(160 * input_wav.shape[0] // zc, device=config.device)
        fade_in = torch.sin(0.5 * np.pi * torch.linspace(0.0, 1.0, steps=sola_frame, device=config.device)) ** 2
        fade_out = 1 - fade_in
        sola_buffer = torch.zeros(sola_frame, device=config.device)
        input_resampler = audio_transforms.Resample(sample_rate, 16000).to(config.device)
        output_resampler = audio_transforms.Resample(int(rvc.tgt_sr), sample_rate).to(config.device) if int(rvc.tgt_sr) != sample_rate else None

        controls = {"gain": float(options.get("outputGain", 1.0)), "pitch": int(options.get("pitch", 0)), "record": bool(options.get("record", False))}
        stopping = threading.Event()
        failed = threading.Event()
        metric_lock = threading.Lock()
        metrics = {"inferMs": 0.0, "inputLevel": 0.0, "outputLevel": 0.0, "overflowCount": 0, "underflowCount": 0, "samples": 0}
        record_queue = queue.Queue(maxsize=64)
        recorder = None
        record_thread = None

        if controls["record"]:
            record_path = Path(options["recordPath"])
            record_path.parent.mkdir(parents=True, exist_ok=True)
            import soundfile as sf
            recorder = sf.SoundFile(str(record_path), mode="w", samplerate=sample_rate, channels=1, format="WAV", subtype="PCM_16")

        def control_reader():
            nonlocal controls
            for line in sys.stdin:
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if message.get("type") == "stop":
                    stopping.set()
                    return
                if message.get("type") == "controls":
                    gain = message.get("gain")
                    pitch = message.get("pitch")
                    if isinstance(gain, (int, float)) and 0 <= gain <= 2:
                        controls["gain"] = float(gain)
                    if isinstance(pitch, int) and -24 <= pitch <= 24:
                        controls["pitch"] = pitch
                        rvc.change_key(pitch)

        threading.Thread(target=control_reader, daemon=True).start()
        if recorder:
            def write_recording():
                try:
                    while True:
                        frame = record_queue.get()
                        if frame is None:
                            break
                        recorder.write(frame)
                    recorder.close()
                    write_event("recording", path=str(record_path), bytes=record_path.stat().st_size if record_path.exists() else 0)
                except Exception as error:
                    failed.set()
                    write_event("error", message=f"实时录音保存失败：{error}", detail=traceback.format_exc())
            record_thread = threading.Thread(target=write_recording, daemon=True)
            record_thread.start()

        last_telemetry = 0.0
        started = time.monotonic()
        write_event("ready", sampleRate=sample_rate, blockDurationMs=block_frame * 1000 / sample_rate,
                    inputDeviceId=str(input_id), outputDeviceId=str(output_id), modelPath=str(model_path))

        def callback(indata, outdata, frames, _timing, status):
            nonlocal last_telemetry, sola_buffer
            if stopping.is_set() or failed.is_set():
                outdata.fill(0)
                raise sd.CallbackStop
            if status:
                with metric_lock:
                    if getattr(status, "input_overflow", False): metrics["overflowCount"] += 1
                    if getattr(status, "output_underflow", False): metrics["underflowCount"] += 1
            try:
                started_at = time.perf_counter()
                mono = np.asarray(indata, dtype=np.float32).mean(axis=1)
                if frames != block_frame:
                    raise RuntimeError(f"音频设备块大小异常：期望 {block_frame}，收到 {frames}")
                input_wav[:-block_frame] = input_wav[block_frame:].clone()
                input_wav[-block_frame:] = torch.from_numpy(mono).to(config.device)
                resampled_history[:-block_frame_16k] = resampled_history[block_frame_16k:].clone()
                converted = input_resampler(input_wav[-block_frame - 2 * zc:])[160:]
                converted = converted[-block_frame_16k:]
                resampled_history[-converted.shape[0]:] = converted
                result = rvc.infer(resampled_history, block_frame_16k, skip_head, return_length, f0_method)
                if output_resampler is not None:
                    result = output_resampler(result)

                if result.shape[0] < block_frame + sola_frame + search_frame:
                    result = torch.nn.functional.pad(result, (0, block_frame + sola_frame + search_frame - result.shape[0]))
                overlap = result[:sola_frame + search_frame]
                correlation = torch.nn.functional.conv1d(
                    overlap[None, None, :] ** 2,
                    torch.ones(1, 1, sola_frame, device=config.device),
                ) + 1e-8
                numerator = torch.nn.functional.conv1d(overlap[None, None, :], sola_buffer[None, None, :])
                offset = int(torch.argmax(numerator[0, 0] / torch.sqrt(correlation[0, 0])).item())
                result = result[offset:]
                result[:sola_frame] = result[:sola_frame] * fade_in + sola_buffer * fade_out
                sola_buffer = result[block_frame:block_frame + sola_frame].clone()
                audio = result[:block_frame] * controls["gain"]
                audio = torch.clamp(audio, -1.0, 1.0)
                output = audio.detach().float().cpu().numpy()
                if len(output) < frames:
                    output = np.pad(output, (0, frames - len(output)))
                outdata[:, 0] = output[:frames]
                if recorder and controls["record"]:
                    try:
                        record_queue.put_nowait(output[:frames].copy())
                    except queue.Full:
                        with metric_lock:
                            metrics["overflowCount"] += 1
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                now = time.monotonic()
                with metric_lock:
                    metrics["inferMs"] = elapsed_ms
                    metrics["inputLevel"] = float(np.sqrt(np.mean(mono * mono)))
                    metrics["outputLevel"] = float(np.sqrt(np.mean(output[:frames] * output[:frames])))
                    metrics["samples"] += 1
                if now - last_telemetry >= 0.5:
                    with metric_lock:
                        snapshot = dict(metrics)
                    write_event("telemetry", **snapshot, elapsedSeconds=now - started,
                                estimatedBufferMs=extra_seconds * 1000 + block_frame * 1000 / sample_rate)
                    last_telemetry = now
                if elapsed_ms > block_frame * 1000 / sample_rate:
                    with metric_lock:
                        metrics["overflowCount"] += 1
            except Exception as error:
                failed.set()
                outdata.fill(0)
                write_event("error", message=f"实时处理停止：{error}", detail=traceback.format_exc())
                raise sd.CallbackAbort

        stream = sd.Stream(device=(input_id, output_id), samplerate=sample_rate,
                           blocksize=block_frame, channels=(1, 1), dtype="float32", callback=callback)
        try:
            stream.start()
            write_event("running", startedAt=time.time())
            while stream.active and not stopping.wait(0.1) and not failed.is_set():
                pass
        finally:
            stopping.set()
            try:
                stream.stop()
            finally:
                stream.close()
            if recorder:
                deadline = time.monotonic() + 15
                while record_thread.is_alive():
                    try:
                        record_queue.put(None, timeout=0.25)
                        break
                    except queue.Full:
                        if time.monotonic() >= deadline:
                            failed.set()
                            write_event("error", message="实时录音队列未能及时写入，录音文件可能不完整")
                            break
                record_thread.join(timeout=1)
                if record_thread.is_alive():
                    failed.set()
                    write_event("error", message="实时录音写入线程未能正常结束，录音文件可能不完整")
                elif not recorder.closed:
                    recorder.close()
            write_event("stopped", elapsedSeconds=time.monotonic() - started)
        return 1 if failed.is_set() else 0
    except Exception as error:
        write_event("error", message=str(error), detail=traceback.format_exc())
        return 2


def parse_device_id(value):
    if not isinstance(value, str) or ":" not in value:
        raise ValueError("请重新扫描并选择输入/输出设备")
    host_id, device_id = value.split(":", 1)
    return int(host_id), int(device_id)


if __name__ == "__main__":
    sys.exit(main())
