"""
OpenSight Local YOLO Detection Server
--------------------------------------
Usage:
    python detect_server.py [--port 8000] [--default-model yolo11n.pt] [--conf 0.25] [--iou 0.45]

API:
    GET  /health          - 服务健康检查，返回当前加载的模型信息
    POST /detect          - 目标检测（multipart/form-data, field: file=图片）
    POST /upload          - 上传并加载新的 .pt 模型文件（multipart/form-data, field: file=模型文件）
"""

import argparse
import io
import os
import tempfile
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
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


def load_model(model_path: str) -> None:
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


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    if _model is None:
        raise HTTPException(status_code=503, detail="没有加载的模型，请先 POST /upload 上传模型或在启动时指定 --default-model")

    # 读取图片
    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析图片: {e}")

    # 推理
    results = _model.predict(
        source=image,
        conf=_conf_threshold,
        iou=_iou_threshold,
        verbose=False,
    )

    # 转换为前端期望的格式
    # DetectionAPIResponse: { status, total, results: [{info: {id, name, confidence}, bbox: [x1,y1,x2,y2]}] }
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


@app.post("/upload")
async def upload_model(file: UploadFile = File(...)):
    if not file.filename.endswith(".pt"):
        raise HTTPException(status_code=400, detail="只支持 .pt 格式的 PyTorch 模型文件")

    # 保存到临时目录（与 detect_server.py 同级的 models/ 文件夹）
    models_dir = Path(__file__).parent / "models"
    models_dir.mkdir(exist_ok=True)
    dest_path = models_dir / file.filename

    contents = await file.read()
    dest_path.write_bytes(contents)

    try:
        load_model(str(dest_path))
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"模型加载失败: {e}")

    return {
        "status": "success",
        "model": _model_name,
        "message": f"模型 {_model_name} 已加载，检测地址: POST /detect",
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
