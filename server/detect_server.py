"""
OpenSight Local YOLO Detection Server
--------------------------------------
Usage:
    python detect_server.py [--port 8000] [--default-model yolo11n.pt] [--conf 0.25] [--iou 0.45]

API:
    GET  /health          - 服务健康检查，返回当前加载的模型信息 + model_tasks
    POST /detect          - 目标检测（multipart/form-data, field: file=图片）
    POST /segment         - 实例分割（multipart/form-data, file + 可选 point/bbox prompt）
    POST /upload          - 上传并加载新的 .pt/.onnx 模型文件（返回 service 字段）
    POST /load-model      - 按名称加载 ultralytics 官方模型（自动下载）
    GET  /load-status     - 获取模型加载进度
    GET  /loaded-models   - 列出所有已加载到内存的模型
    POST /switch-model    - 切换当前活跃模型（不重新加载）
    POST /unload-model    - 从内存中卸载指定模型
"""

import argparse
import io
import threading
from pathlib import Path
from typing import Dict, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel
from ultralytics import YOLO

app = FastAPI(title="OpenSight Detection Server")

# 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── 多模型全局状态 ──
_models: Dict[str, YOLO] = {}       # name -> YOLO instance
_active_model_name: str = ""         # 当前活跃模型名
_conf_threshold: float = 0.25
_iou_threshold: float = 0.45

# 加载进度状态
_load_status = {
    "state": "idle",       # idle | downloading | loading | ready | error
    "progress": 0,         # 0-100
    "model": "",
    "error": "",
}
_load_lock = threading.Lock()


def _get_active_model() -> Optional[YOLO]:
    return _models.get(_active_model_name)


def _update_status(state: str, progress: int = 0, model: str = "", error: str = ""):
    with _load_lock:
        _load_status["state"] = state
        _load_status["progress"] = progress
        _load_status["model"] = model or _load_status["model"]
        _load_status["error"] = error


def _load_model_thread(name: str):
    """在后台线程中加载模型，更新进度"""
    global _active_model_name
    try:
        _update_status("downloading", 10, model=name)
        print(f"[OpenSight] 加载模型: {name} ...")

        _update_status("downloading", 30)
        model = YOLO(name)
        _update_status("loading", 80)

        _models[name] = model
        _active_model_name = name
        _update_status("ready", 100, model=name)
        print(f"[OpenSight] 模型加载完成: {name}  (共 {len(_models)} 个模型在内存)")

    except Exception as e:
        _update_status("error", 0, error=str(e))
        print(f"[OpenSight] 模型加载失败: {e}")


_BUILTIN_VARIANTS = {
    # detection
    "yolo26n","yolo26s","yolo26m","yolo26l","yolo26x",
    "yolo12n","yolo12s","yolo12m","yolo12l","yolo12x",
    "yolo11n","yolo11s","yolo11m","yolo11l","yolo11x",
    "yolov10n","yolov10s","yolov10m","yolov10l","yolov10x",
    "yolov9t","yolov9s","yolov9m","yolov9c","yolov9e",
    "yolov8n","yolov8s","yolov8m","yolov8l","yolov8x",
    # segmentation
    "yolov8n-seg","yolov8s-seg","yolov8m-seg","yolov8l-seg","yolov8x-seg",
    "yolo11n-seg","yolo11s-seg","yolo11m-seg","yolo11l-seg","yolo11x-seg",
    "sam2.1_t","sam2.1_s","sam2.1_b","sam2.1_l",
    "mobile_sam","FastSAM-s","FastSAM-x",
}

def _is_builtin(name: str) -> bool:
    """判断模型名是否属于内置家族"""
    base = name.replace(".pt", "").replace(".onnx", "")
    return base in _BUILTIN_VARIANTS


def load_model(model_path: str) -> None:
    """加载本地 .pt 文件，添加到多模型字典并设为活跃。
    自定义模型覆盖：新自定义模型会卸载之前的自定义模型，内置模型不受影响。"""
    global _active_model_name
    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(f"模型文件不存在: {model_path}")

    new_name = path.name
    # 若新模型是自定义的，卸载之前所有自定义模型（内置模型保留）
    if not _is_builtin(new_name):
        old_custom = [n for n in _models if not _is_builtin(n) and n != new_name]
        for n in old_custom:
            del _models[n]
            print(f"[OpenSight] 自定义模型覆盖：卸载旧模型 {n}")

    print(f"[OpenSight] 加载模型: {new_name} ...")
    _models[new_name] = YOLO(str(path))
    _active_model_name = new_name
    print(f"[OpenSight] 模型加载完成: {new_name}  (共 {len(_models)} 个模型在内存)")


def _get_model_task(name: str) -> str:
    """获取模型的 task 类型（detect/segment/classify/pose 等）"""
    m = _models.get(name)
    if m is None:
        return "unknown"
    return getattr(m, "task", "detect") or "detect"


@app.get("/health")
def health():
    active_task = _get_model_task(_active_model_name) if _active_model_name else "none"
    return {
        "status": "ok",
        "model": _active_model_name or "none",
        "model_task": active_task,
        "model_loaded": len(_models) > 0,
        "conf": _conf_threshold,
        "iou": _iou_threshold,
        # 所有已加载模型列表，前端用来渲染下拉
        "loaded_models": list(_models.keys()),
        # 每个模型的 task 类型，供前端判断检测/分割
        "model_tasks": {name: _get_model_task(name) for name in _models},
    }


@app.get("/load-status")
def load_status():
    with _load_lock:
        return dict(_load_status)


@app.get("/available-models")
def available_models():
    """列出本地已下载的 .pt 模型文件"""
    from ultralytics import settings as ul_settings
    # ultralytics 默认缓存目录
    weights_dir = Path(ul_settings.get("weights_dir", Path.home() / ".ultralytics" / "weights"))
    # 也检查当前工作目录和 server/models/
    search_dirs = [weights_dir, Path.cwd(), Path(__file__).parent / "models"]
    found = set()
    for d in search_dirs:
        if d.exists():
            for f in d.glob("*.pt"):
                found.add(f.stem)  # e.g. "yolo26n"
    return {"models": sorted(found)}


@app.get("/loaded-models")
def loaded_models():
    """列出当前所有已加载到内存的模型"""
    return {
        "active": _active_model_name,
        "models": list(_models.keys()),
    }


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    conf: Optional[float] = Form(None),
    iou: Optional[float] = Form(None),
    imgsz: Optional[int] = Form(None),
    max_det: Optional[int] = Form(None),
):
    model = _get_active_model()
    if model is None:
        raise HTTPException(status_code=503, detail="没有加载的模型，请先加载模型")

    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析图片: {e}")

    # 请求级参数覆盖服务级默认值
    predict_kwargs = {
        "source": image,
        "conf": conf if conf is not None else _conf_threshold,
        "iou": iou if iou is not None else _iou_threshold,
        "verbose": False,
    }
    if imgsz is not None:
        predict_kwargs["imgsz"] = imgsz
    if max_det is not None:
        predict_kwargs["max_det"] = max_det

    results = model.predict(**predict_kwargs)

    detections = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                class_name = model.names.get(cls_id, str(cls_id))
                detections.append({
                    "info": {
                        "id": cls_id,
                        "name": class_name,
                        "confidence": round(conf, 4),
                    },
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                })

    return {
        "status": "success",
        "total": len(detections),
        "results": detections,
    }


@app.post("/segment")
async def segment(
    file: UploadFile = File(...),
    conf: Optional[float] = Form(None),
    iou: Optional[float] = Form(None),
    imgsz: Optional[int] = Form(None),
    max_det: Optional[int] = Form(None),
    point: Optional[str] = Form(None),
    bbox: Optional[str] = Form(None),
):
    """实例分割端点 — 返回多边形 mask + bbox"""
    model = _get_active_model()
    if model is None:
        raise HTTPException(status_code=503, detail="没有加载的模型，请先加载模型")

    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析图片: {e}")

    predict_kwargs = {
        "source": image,
        "conf": conf if conf is not None else _conf_threshold,
        "iou": iou if iou is not None else _iou_threshold,
        "retina_masks": True,   # 关键：mask 坐标返回原图分辨率，否则是模型内部分辨率
        "verbose": False,
    }
    if imgsz is not None:
        predict_kwargs["imgsz"] = imgsz
    if max_det is not None:
        predict_kwargs["max_det"] = max_det

    # SAM prompt 支持
    if point:
        try:
            px, py = [int(v.strip()) for v in point.split(",")]
            predict_kwargs["points"] = [[px, py]]
            predict_kwargs["labels"] = [1]
        except Exception:
            pass
    elif bbox:
        try:
            coords = [int(v.strip()) for v in bbox.split(",")]
            if len(coords) == 4:
                predict_kwargs["bboxes"] = [coords]
        except Exception:
            pass

    results = model.predict(**predict_kwargs)

    segmentations = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes
        masks = result.masks

        if boxes is not None:
            for i, box in enumerate(boxes):
                cls_id = int(box.cls[0].item())
                conf_val = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                class_name = model.names.get(cls_id, str(cls_id))

                # 提取多边形 mask
                mask_polygon = []
                if masks is not None and i < len(masks):
                    xy = masks[i].xy  # list of ndarray, each shape (N, 2)
                    if xy is not None and len(xy) > 0:
                        # 取最大的多边形（通常只有一个）
                        largest = max(xy, key=lambda p: len(p))
                        mask_polygon = [[round(float(pt[0])), round(float(pt[1]))] for pt in largest]

                segmentations.append({
                    "info": {
                        "id": cls_id,
                        "name": class_name,
                        "confidence": round(conf_val, 4),
                    },
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                    "mask": mask_polygon,
                })

    return {
        "status": "success",
        "total": len(segmentations),
        "results": segmentations,
    }


class LoadModelRequest(BaseModel):
    model: str = "yolo11n.pt"

@app.post("/load-model")
async def load_model_endpoint(req: LoadModelRequest):
    """按名称加载 ultralytics 官方模型（后台下载，通过 /load-status 查询进度）"""
    # 如果模型已在内存中，直接切换为活跃，无需重新加载
    if req.model in _models:
        global _active_model_name
        _active_model_name = req.model
        _update_status("ready", 100, model=req.model)
        return {"status": "already_loaded", "model": req.model}

    with _load_lock:
        if _load_status["state"] in ("downloading", "loading"):
            return {"status": "already_loading", "model": _load_status["model"]}

    _update_status("downloading", 5, model=req.model)
    thread = threading.Thread(target=_load_model_thread, args=(req.model,), daemon=True)
    thread.start()
    return {"status": "loading", "model": req.model}


@app.post("/upload")
async def upload_model(file: UploadFile = File(...)):
    if not (file.filename.endswith(".pt") or file.filename.endswith(".onnx")):
        raise HTTPException(status_code=400, detail="只支持 .pt / .onnx 格式的模型文件")

    models_dir = Path(__file__).parent / "models"
    models_dir.mkdir(exist_ok=True)
    dest_path = models_dir / file.filename

    _update_status("downloading", 50, model=file.filename)
    contents = await file.read()
    dest_path.write_bytes(contents)

    try:
        _update_status("loading", 80)
        load_model(str(dest_path))
        _update_status("ready", 100, model=_active_model_name)
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        _update_status("error", 0, error=str(e))
        raise HTTPException(status_code=422, detail=f"模型加载失败: {e}")

    # 通过 model.task 判断类型：'segment' → segmentation, 其他 → detection
    task = _get_model_task(_active_model_name)
    service = "segmentation" if task == "segment" else "detection"

    return {
        "status": "success",
        "model": _active_model_name,
        "service": service,
        "message": f"模型 {_active_model_name} 已加载 (task={task})",
    }


class SwitchModelRequest(BaseModel):
    model: str

@app.post("/switch-model")
async def switch_model(req: SwitchModelRequest):
    """切换活跃模型（模型必须已加载在内存中）"""
    global _active_model_name
    if req.model not in _models:
        raise HTTPException(
            status_code=404,
            detail=f"模型 '{req.model}' 未加载，当前已加载: {list(_models.keys())}"
        )
    _active_model_name = req.model
    return {"status": "ok", "active": _active_model_name}


class UnloadModelRequest(BaseModel):
    model: str

@app.post("/unload-model")
async def unload_model(req: UnloadModelRequest):
    """从内存中卸载指定模型"""
    global _active_model_name
    if req.model not in _models:
        raise HTTPException(status_code=404, detail=f"模型 '{req.model}' 未加载")
    del _models[req.model]
    # 如果卸载的是当前活跃模型，切换到剩余的第一个（或清空）
    if _active_model_name == req.model:
        _active_model_name = next(iter(_models), "")
    return {
        "status": "ok",
        "unloaded": req.model,
        "active": _active_model_name,
        "remaining": list(_models.keys()),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenSight Local YOLO Detection Server")
    parser.add_argument("--port", type=int, default=8000, help="监听端口 (默认 8000)")
    parser.add_argument("--default-model", type=str, default="", help="启动时加载的模型路径")
    parser.add_argument("--conf", type=float, default=0.25, help="置信度阈值 (默认 0.25)")
    parser.add_argument("--iou", type=float, default=0.45, help="NMS IoU 阈值 (默认 0.45)")
    args = parser.parse_args()

    _conf_threshold = args.conf
    _iou_threshold = args.iou

    if args.default_model:
        try:
            load_model(args.default_model)
        except FileNotFoundError as e:
            print(f"[警告] {e}，服务仍将启动，可通过 POST /upload 上传模型")

    print(f"[OpenSight] 服务启动: http://localhost:{args.port}")
    print(f"[OpenSight] 检测接口: POST http://localhost:{args.port}/detect")
    print(f"[OpenSight] 上传模型: POST http://localhost:{args.port}/upload")
    uvicorn.run(app, host="0.0.0.0", port=args.port)
