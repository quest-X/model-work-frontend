"""
OpenSight Local YOLO Detection Server
--------------------------------------
Usage:
    python detect_server.py [--port 8000] [--default-model yolo11n.pt] [--conf 0.25] [--iou 0.45]

API:
    GET  /health          - 服务健康检查，返回当前加载的模型信息
    POST /detect          - 目标检测（multipart/form-data, field: file=图片）
    POST /upload          - 上传并加载新的 .pt 模型文件（multipart/form-data, field: file=模型文件）
    POST /load-model      - 按名称加载 ultralytics 官方模型（自动下载）
    GET  /load-status     - 获取模型加载进度
"""

import argparse
import io
import threading
from pathlib import Path
from typing import Optional

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

# 全局状态
_model: Optional[YOLO] = None
_model_name: str = "none"
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


def _update_status(state: str, progress: int = 0, model: str = "", error: str = ""):
    with _load_lock:
        _load_status["state"] = state
        _load_status["progress"] = progress
        _load_status["model"] = model or _load_status["model"]
        _load_status["error"] = error


def _load_model_thread(name: str):
    """在后台线程中加载模型，更新进度"""
    global _model, _model_name
    try:
        _update_status("downloading", 10, model=name)
        print(f"[OpenSight] 加载模型: {name} ...")

        _update_status("downloading", 30)
        model = YOLO(name)
        _update_status("loading", 80)

        _model = model
        _model_name = name
        _update_status("ready", 100, model=name)
        print(f"[OpenSight] 模型加载完成: {_model_name}")

    except Exception as e:
        _update_status("error", 0, error=str(e))
        print(f"[OpenSight] 模型加载失败: {e}")


def load_model(model_path: str) -> None:
    """加载本地 .pt 文件"""
    global _model, _model_name
    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(f"模型文件不存在: {model_path}")
    print(f"[OpenSight] 加载模型: {path.name} ...")
    _model = YOLO(str(path))
    _model_name = path.name
    print(f"[OpenSight] 模型加载完成: {_model_name}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": _model_name,
        "model_loaded": _model is not None,
        "conf": _conf_threshold,
        "iou": _iou_threshold,
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


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    conf: Optional[float] = Form(None),
    iou: Optional[float] = Form(None),
    imgsz: Optional[int] = Form(None),
    max_det: Optional[int] = Form(None),
):
    if _model is None:
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

    results = _model.predict(**predict_kwargs)

    detections = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                class_name = _model.names.get(cls_id, str(cls_id))
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


class LoadModelRequest(BaseModel):
    model: str = "yolo11n.pt"

@app.post("/load-model")
async def load_model_endpoint(req: LoadModelRequest):
    """按名称加载 ultralytics 官方模型（后台下载，通过 /load-status 查询进度）"""
    with _load_lock:
        if _load_status["state"] in ("downloading", "loading"):
            return {"status": "already_loading", "model": _load_status["model"]}

    _update_status("downloading", 5, model=req.model)
    thread = threading.Thread(target=_load_model_thread, args=(req.model,), daemon=True)
    thread.start()
    return {"status": "loading", "model": req.model}


@app.post("/upload")
async def upload_model(file: UploadFile = File(...)):
    if not file.filename.endswith(".pt"):
        raise HTTPException(status_code=400, detail="只支持 .pt 格式的 PyTorch 模型文件")

    models_dir = Path(__file__).parent / "models"
    models_dir.mkdir(exist_ok=True)
    dest_path = models_dir / file.filename

    _update_status("downloading", 50, model=file.filename)
    contents = await file.read()
    dest_path.write_bytes(contents)

    try:
        _update_status("loading", 80)
        load_model(str(dest_path))
        _update_status("ready", 100, model=_model_name)
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        _update_status("error", 0, error=str(e))
        raise HTTPException(status_code=422, detail=f"模型加载失败: {e}")

    return {
        "status": "success",
        "model": _model_name,
        "message": f"模型 {_model_name} 已加载",
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
