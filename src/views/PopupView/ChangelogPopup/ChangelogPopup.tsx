import React, {useEffect, useState} from 'react';
import './ChangelogPopup.scss';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {ContextManager} from '../../../logic/context/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface ChangelogEntry {
    version: string;
    date: string;
    changes: { zh: string; en: string }[];
}

const CHANGELOG_DATA: ChangelogEntry[] = [
    {
        version: '1.9.8',
        date: '2026-04-09',
        changes: [
            { zh: '重构导入标注弹窗：去掉 GenericLabelTypePopup 包裹，改用 GenericYesNoPopup 直接渲染，修复 dropzone 事件失效', en: 'Rewrite import popup: remove GenericLabelTypePopup wrapper, use GenericYesNoPopup directly, fix dropzone events' },
            { zh: '支持 .zip 文件直接导入：自动解压并根据文件名前缀识别格式（yolo_/voc_/coco_/vgg_）', en: 'Support .zip file import: auto-unzip and detect format from filename prefix (yolo_/voc_/coco_/vgg_)' },
            { zh: '自动格式检测回退：labels.txt→YOLO, .xml→VOC, .json→COCO', en: 'Auto format detection fallback: labels.txt→YOLO, .xml→VOC, .json→COCO' },
        ]
    },
    {
        version: '1.9.7',
        date: '2026-04-08',
        changes: [
            { zh: 'FFmpeg 帧提取超时改为无限制，支持 10GB+ 大视频', en: 'FFmpeg frame extraction timeout removed, supports 10GB+ videos' },
            { zh: 'YOLO 导出自动包含 labels.txt（简单/完整模式均支持）', en: 'YOLO export now includes labels.txt in both Simple and Complete modes' },
            { zh: '上传/导入文案调整：点击上传优先展示', en: 'Upload/import text adjusted: click-to-upload shown first' },
        ]
    },
    {
        version: '1.9.6',
        date: '2026-04-08',
        changes: [
            { zh: '导出标注新增简单/完整模式切换：完整模式包含图像 + 标签 + 8:1:1 数据集划分', en: 'Export annotations: add Simple/Complete mode toggle — Complete includes images + labels + 8:1:1 dataset split' },
            { zh: '所有导出格式（YOLO/VOC/COCO/VGG/CSV）均支持完整模式', en: 'All export formats (YOLO/VOC/COCO/VGG/CSV) support Complete mode' },
            { zh: '导入标注简化：去掉格式选择步骤，拖拽文件自动识别格式（.json→COCO, .txt→YOLO, .xml→VOC）', en: 'Simplify import: remove format selection, auto-detect from file extension (.json→COCO, .txt→YOLO, .xml→VOC)' },
            { zh: '导出格式描述简化为格式名 + 简要说明', en: 'Simplify export format labels to name + brief description' },
            { zh: '修复导出/导入弹窗 JSX 多余逗号渲染为文本', en: 'Fix stray comma rendered as text in export/import popups' },
            { zh: '修复推理通知中硬编码中文"帧"，改用 LanguageConfig', en: 'Fix hardcoded Chinese "帧" in inference notifications, use LanguageConfig' },
        ]
    },
    {
        version: '1.9.5',
        date: '2026-04-08',
        changes: [
            { zh: '本地模型弹窗重构为三区布局：自定义 / 检测模型 / 分割模型', en: 'Refactor local model popup into 3-section layout: Custom / Detection / Segmentation' },
            { zh: '自定义区新增 .pt / .onnx / .engine 三种格式选项（后两者占位）', en: 'Custom section adds .pt / .onnx / .engine format options (latter two as placeholders)' },
            { zh: '分割模型区添加 SAM 系列占位（SAM / SAM 2 / SAM 3 / MobileSAM / FastSAM）', en: 'Segmentation section adds SAM family placeholders (SAM / SAM 2 / SAM 3 / MobileSAM / FastSAM)' },
            { zh: '弹窗内容区支持滚动，底部按钮不再被遮挡', en: 'Popup content area now scrollable, footer buttons no longer clipped' },
            { zh: '模型列表已下载数量字号统一', en: 'Unify downloaded model count font size in model list' },
        ]
    },
    {
        version: '1.9.4',
        date: '2026-04-08',
        changes: [
            { zh: '隐藏点标注和线条标注功能（工具栏、侧栏、导入导出弹窗）', en: 'Hide point and line annotation features (toolbar, sidebar, import/export popups)' },
            { zh: '标签类型重命名：矩形框→检测标签，多边形→分割标签', en: 'Rename label types: Rect→Detection, Polygon→Segmentation' },
            { zh: '模型弹窗重命名：加载AI模型→本地模型，接入AI模型→远程模型', en: 'Rename model popups: Load AI Model→Local Model, Integrate AI Model→Remote Model' },
            { zh: '全部标签图标统一使用 all.png', en: 'Unify "All Labels" icon to all.png' },
            { zh: '文件名过长时底栏省略中部显示，悬停查看完整名', en: 'Truncate long filenames in bottom bar with ellipsis, hover for full name' },
            { zh: '推理结果坐标标签缩写为 Coords 防止挤压', en: 'Shorten coordinates label to Coords to prevent overflow' },
            { zh: '修复重新开始后黑屏：PolygonLabelsList 空数据保护', en: 'Fix black screen after fresh start: PolygonLabelsList null-data guard' },
        ]
    },
    {
        version: '1.9.3',
        date: '2026-04-08',
        changes: [
            { zh: '恢复多边形标注功能：从 origin 还原 PolygonRenderEngine、多边形导出器（VGG/COCO）及侧栏列表', en: 'Restore polygon annotation: bring back PolygonRenderEngine, polygon exporters (VGG/COCO) and sidebar list from origin' },
            { zh: '修复导出/导入标注弹窗黑屏：当标签视图为"全部"时打开弹窗不再崩溃', en: 'Fix export/import popup black screen: opening popup in "ALL" label view no longer crashes' },
            { zh: '修复多边形标签列表硬编码英文，改用 LanguageConfig 中英双语', en: 'Fix hardcoded English in PolygonLabelsList, now uses LanguageConfig for i18n' },
            { zh: '恢复弹窗标题文案优化', en: 'Restore dialog title text refinement' },
        ]
    },
    {
        version: '1.9.2',
        date: '2026-04-06',
        changes: [
            { zh: '编辑模式支持边框拖拽移动矩形（对齐 v2），边缘悬停显示抓手光标', en: 'Edit mode supports border drag to move rects (align with v2), edge hover shows grab cursor' },
            { zh: '修复刷新恢复后文件队列丢失：队列项和活动队列 ID 现在持久化到 IndexedDB', en: 'Fix file queue lost after refresh restore: queue items and active queue ID now persisted to IndexedDB' },
            { zh: '修复刷新恢复后推理结果丢失：推理结果按图像 ID 存储，视频批量检测结果也纳入持久化', en: 'Fix inference results lost after refresh restore: results stored per image ID, video batch detection results also persisted' },
        ]
    },
    {
        version: '1.9.1',
        date: '2026-04-06',
        changes: [
            { zh: '修复视频模式缩放：鼠标滚轮缩放时视频帧与检测框同步缩放', en: 'Fix video mode zoom: video frame now scales together with detection boxes on mouse wheel zoom' },
            { zh: '修复文件队列中英文切换不完全：帧数/图像数等备注现在跟随语言动态显示', en: 'Fix incomplete i18n in file queue: frame/image count metadata now updates dynamically with language switch' },
        ]
    },
    {
        version: '1.9.0',
        date: '2026-04-06',
        changes: [
            { zh: '修复缩略图选中蓝色边框上部与右侧宽度不一致（box-sizing 修正）', en: 'Fix thumbnail selection blue border uneven width between top and right (box-sizing fix)' },
            { zh: '点击标签色块直接打开编辑标签弹窗', en: 'Click label color marker to open label editor popup directly' },
            { zh: '关闭按类别着色时，标签文字背景同步关闭颜色', en: 'Label text background respects per-class coloration toggle' },
            { zh: '界面文案优化："更新标签列表"→"编辑标签"，"创建项目"→"确认"', en: 'UI text refinement: "Update labels list" → "Edit labels", "Create project" → "Confirm"' },
        ]
    },
    {
        version: '1.8.9',
        date: '2026-04-06',
        changes: [
            { zh: '修复帧率硬编码：视频 fps 不再写死 30，自动使用原始帧率（支持 120fps/60fps/50fps 等）', en: 'Fix hardcoded fps: video fps no longer forced to 30, auto-detect original frame rate (120/60/50fps etc.)' },
            { zh: '播放引擎重构：setInterval → requestAnimationFrame + 时间驱动，消除异步绘制竞争', en: 'Playback engine rewrite: setInterval → rAF + time-driven, eliminate async draw races' },
            { zh: '修复播放无法到达最后一帧：节流绕过 + 闭包帧号修正 + 最后一帧确保画完再暂停', en: 'Fix playback not reaching last frame: throttle bypass + stale closure fix + ensure last frame drawn before pause' },
            { zh: '帧缓冲区改为 fps 自适应：基于秒数 × fps 动态计算，高帧率视频缓冲更充足', en: 'Frame buffer fps-aware: dynamically calculated as seconds × fps, better buffering for high-fps videos' },
            { zh: 'fps 兜底增加 console.warn，快速定位帧率缺失问题', en: 'Add console.warn for fps fallback, quickly identify missing fps issues' },
        ]
    },
    {
        version: '1.8.8',
        date: '2026-04-05',
        changes: [
            { zh: '帧加载架构重写：available_frames 滑动窗口（前方 500 帧保障 + 2000 帧缓存上限 + 自动淘汰旧帧）', en: 'Frame loading rewrite: available_frames sliding window (500 ahead guarantee + 2000 cache cap + auto-evict old frames)' },
            { zh: '帧完整加载统一：取帧 + 解码 Image + 生成缩略图一体化，不再分开抢资源', en: 'Unified frame loading: fetch + decode + thumbnail in one pass, no more resource contention' },
            { zh: '初始加载 500 帧完成后才允许播放，显示"解析中 X%"进度', en: 'Playback enabled only after initial 500 frames loaded, with "Parsing X%" progress' },
            { zh: '播放时后台加载暂停，全部资源给播放保证流畅', en: 'Background loading paused during playback, all resources dedicated to smooth playback' },
            { zh: '跳播快速缓存 500 帧图片（不生成缩略图），优先保证播放连续', en: 'Seek preloads 500 frame images (skip thumbnails) for immediate playback continuity' },
            { zh: '去掉 EditorContainer 预解码 100 帧，上传完直接交给 FramePlayer 统一处理', en: 'Removed EditorContainer 100-frame pre-decode, upload hands off to FramePlayer directly' },
            { zh: '后端会话自动清理：新上传时清理所有旧会话临时文件', en: 'Backend session auto-cleanup: all old session temp files cleaned on new upload' },
            { zh: '修复大视频推理 500 错误：按需模式帧占位文件为空，改为从已解码 Image 截取像素', en: 'Fix large video detection 500 error: on-demand placeholder files were empty, now captures pixels from decoded Image' },
        ]
    },
    {
        version: '1.8.7',
        date: '2026-04-05',
        changes: [
            { zh: '大视频按需取帧：后端 FFmpeg 用 -frames:v 替代 -t，修复单帧提取失败', en: 'Large video on-demand: backend FFmpeg uses -frames:v instead of -t, fix single-frame extraction failure' },
            { zh: '前端批量取帧（30帧/批）+ 去重，替代逐帧请求，减少 90% HTTP 请求', en: 'Frontend batch frame fetch (30/batch) with dedup, replacing per-frame requests, 90% fewer HTTP calls' },
            { zh: '修复 handleVideoMetadataLoaded 无限循环（imagesData 依赖导致）', en: 'Fix handleVideoMetadataLoaded infinite loop caused by imagesData dependency cycle' },
            { zh: '大视频缩略图改为从后端取帧生成，不再使用慢速 video seek', en: 'Large video thumbnails generated from backend frames instead of slow video seek' },
            { zh: '预加载串行化：逐批加载避免并发 FFmpeg 进程过多', en: 'Serialize preload batches to prevent concurrent FFmpeg process overload' },
            { zh: '修复上传完成时短暂闪回欢迎页的问题', en: 'Fix brief flash-back to welcome page when upload completes' },
        ]
    },
    {
        version: '1.8.6',
        date: '2026-04-05',
        changes: [
            { zh: '视频加载架构升级：fast_ffmpeg_mode（默认）+ raw_browser_mode（回退）双模式', en: 'Video loading architecture: fast_ffmpeg_mode (default) + raw_browser_mode (fallback)' },
            { zh: '大视频（>10K 帧）支持按需取帧，一次上传 + 任意 seek', en: 'Large video (>10K frames) on-demand loading: upload once + seek anywhere' },
            { zh: '3 层智能预取：首屏 P0(0-19) → 播放缓冲 P1(20-499) → 跳帧窗口 P2(-20/+80)', en: '3-tier prefetch: P0 thumbnails(0-19) → P1 playback buffer(20-499) → P2 seek window(-20/+80)' },
            { zh: 'LRU 缓存控制内存（上限 300 帧），自动驱逐远离播放指针的旧帧', en: 'LRU cache memory control (300 frame cap), auto-evict frames far from playhead' },
            { zh: '后端新增 POST /upload-video + GET /frames/{id} API', en: 'Backend: new POST /upload-video + GET /frames/{id} API' },
            { zh: '修复中文文件名导致 HTTP header latin-1 编码失败', en: 'Fix Chinese filename causing HTTP header latin-1 encoding failure' },
            { zh: '大文件流式上传到磁盘（不占后端内存）', en: 'Large file streaming upload to disk (no backend memory usage)' },
        ]
    },
    {
        version: '1.8.5',
        date: '2026-04-05',
        changes: [
            { zh: '修复视频模式恢复工作失败的问题：预拆帧数据现在会保存到 IndexedDB', en: 'Fix video mode restore failure: pre-extracted frames are now saved to IndexedDB' },
            { zh: '恢复时自动重建 preExtractedFrames + extractionMetadata（fps/尺寸等）', en: 'Auto-rebuild preExtractedFrames + extractionMetadata (fps/dimensions) on restore' },
        ]
    },
    {
        version: '1.8.4',
        date: '2026-04-05',
        changes: [
            { zh: '推理结果卡片移除冗余"缩略图"标签', en: 'Remove redundant "Thumbnail" label from inference result cards' },
            { zh: '批量检测通知支持中英双语（捕获帧/推理中）', en: 'Batch detection notifications now support bilingual display (capture/inferring)' },
            { zh: '代码审查：confidence 防御性校验、JSON.parse 容错、帧缓存上限、帧数上限校验', en: 'Code audit: confidence null guard, JSON.parse error handling, frame cache LRU, frame count validation' },
        ]
    },
    {
        version: '1.8.3',
        date: '2026-04-05',
        changes: [
            { zh: '推理结果卡片显示真实置信度（不再显示 0.0%）', en: 'Inference result cards now show real confidence scores (no longer 0.0%)' },
            { zh: '批量检测完成后画面与检测框同步到第一帧', en: 'Canvas and detection boxes sync to frame 1 after batch detection completes' },
            { zh: '视频加载进度直接显示在主画布（上传中 / 解析帧百分比）', en: 'Video loading progress shown directly on main canvas (upload / frame extraction percentage)' },
            { zh: '通知弹窗不再堆叠：新通知立刻替换旧通知', en: 'Notifications no longer stack: new notification immediately replaces the old one' },
        ]
    },
    {
        version: '1.8.2',
        date: '2026-04-05',
        changes: [
            { zh: 'FFmpeg 拆帧后进入视频模式 UI：播放控制栏、时间轴、帧导航完整保留', en: 'FFmpeg extracted frames now enter video mode UI: playback controls, timeline, frame navigation fully preserved' },
            { zh: '新增 FramePlayer 组件：canvas + setInterval 驱动帧播放，不依赖 <video> 元素', en: 'New FramePlayer component: canvas + setInterval driven playback, no <video> element dependency' },
            { zh: '批量检测直接使用预拆帧 JPEG，跳过逐帧 seek+capture，速度大幅提升', en: 'Batch detection uses pre-extracted JPEGs directly, skipping per-frame seek+capture for major speedup' },
            { zh: '缩略图生成使用 createImageBitmap 直接从帧文件生成，无需 video seek', en: 'Thumbnail generation uses createImageBitmap from frame files directly, no video seek needed' },
            { zh: '修复 CORS expose_headers 缺失导致前端无法读取拆帧元数据的问题', en: 'Fix missing CORS expose_headers preventing frontend from reading frame extraction metadata' },
            { zh: '修复播放到末尾后无法重播的问题', en: 'Fix replay not working after playback reaches the end' },
            { zh: '修复视频模式下推理结果面板不随帧切换刷新的问题', en: 'Fix inference results panel not updating when switching frames in video mode' },
        ]
    },
    {
        version: '1.8.1',
        date: '2026-04-05',
        changes: [
            { zh: '后端原生 FFmpeg 拆帧：替换 FFmpeg WASM，174 帧 1920x1440 视频仅需 0.87 秒', en: 'Backend native FFmpeg: replaces WASM, 174 frames of 1920x1440 in 0.87s' },
            { zh: '新增 /extract-frames API：上传视频 → 原生 FFmpeg 拆帧 → ZIP 打包返回', en: 'New /extract-frames API: upload video → native FFmpeg extraction → ZIP response' },
            { zh: '修复 DataCloneError：视频模式下跳过 IndexedDB 保存，防止内存爆炸', en: 'Fix DataCloneError: skip IndexedDB save in video mode, prevent OOM' },
            { zh: '拆帧失败自动回退到传统视频模式', en: 'Auto-fallback to traditional video mode if frame extraction fails' },
        ]
    },
    {
        version: '1.8.0',
        date: '2026-04-04',
        changes: [
            { zh: '【实验性】FFmpeg WASM 前端拆帧（已被 v1.8.1 替换）', en: '[Experimental] FFmpeg WASM frame extraction (superseded by v1.8.1)' },
        ]
    },
    {
        version: '1.7.2',
        date: '2026-04-04',
        changes: [
            { zh: '推理结果面板支持批量检测和恢复后的数据：从 labelRects 自动生成显示卡片', en: 'Inference panel shows results for batch detection and restored projects via labelRects fallback' },
            { zh: '视频帧缩略图从 video 元素直接截取，不再尝试用 img 加载 mp4 文件', en: 'Video frame thumbnails captured from video element directly instead of loading mp4 as image' },
        ]
    },
    {
        version: '1.7.1',
        date: '2026-04-04',
        changes: [
            { zh: '修复恢复工作后缩略图永久转圈：检测视频项目并自动恢复视频模式，重新生成缩略图', en: 'Fix infinite spinner on thumbnails after restore: detect video project and auto-restore video mode' },
            { zh: '修复 IndexedDB 恢复后文件 MIME 类型丢失：同时检查文件扩展名作为兜底', en: 'Fix lost MIME type after IndexedDB restore: fallback to file extension check' },
        ]
    },
    {
        version: '1.7.0',
        date: '2026-04-04',
        changes: [
            { zh: '消除浮点精度丢帧：所有 time→frame 转换改用 Math.round，彻底解决末尾帧差 1-2 帧的问题', en: 'Eliminate float precision frame loss: all time→frame conversions use Math.round, fixing off-by-1-2 frames at video end' },
            { zh: '整数帧号为唯一真相：视频结束帧直接用 totalFrames-1，不再从 duration 浮点重算', en: 'Integer frame as single source of truth: video end frame uses totalFrames-1 directly, no float recomputation' },
            { zh: 'Timeline 标记用帧比例绘制，消除 frame÷fps 浮点误差导致的像素偏移', en: 'Timeline markers use frame ratio for positioning, eliminating frame÷fps float pixel drift' },
            { zh: '批量检测进度实时显示：捕获帧 (n/174)、推理中 (n/174)，步骤指示器同步高亮', en: 'Real-time batch detection progress: capture (n/174), inference (n/174), step indicator synced' },
            { zh: '推理进度通知不再自动消失，直到完成或手动关闭', en: 'Inference progress notification stays until completion or manual dismiss' },
            { zh: '视频末尾自动显示 ↺ 重播按钮', en: 'Auto-show ↺ replay button at video end' },
        ]
    },
    {
        version: '1.6.6',
        date: '2026-04-04',
        changes: [
            { zh: '帧计数改为从 1 开始，最后一帧显示为 174/174 而非 173/174', en: 'Frame counter now starts from 1, last frame shows 174/174 instead of 173/174' },
            { zh: '重播按钮符号统一为 ↺，与播放 ▶ 暂停 ⏸ 风格一致', en: 'Replay button unified to ↺ symbol, consistent with ▶ play and ⏸ pause' },
            { zh: '快捷键提示支持中英双语，新增空格键提示', en: 'Shortcut hints now bilingual, added Space key hint' },
        ]
    },
    {
        version: '1.6.5',
        date: '2026-04-04',
        changes: [
            { zh: '修复通知系统崩溃：检测完成后通知渲染不再报错', en: 'Fix notification crash: detection completion notification no longer throws' },
            { zh: '清理控制台日志噪音：自动保存不再每秒刷屏，控制台只显示有意义的信息', en: 'Clean console logs: auto-save no longer floods console, only meaningful info shown' },
        ]
    },
    {
        version: '1.6.4',
        date: '2026-04-04',
        changes: [
            { zh: '播放流畅性大幅提升：onPlayPauseRef 稳定键盘监听，消除空格键响应丢失', en: 'Major playback smoothness: stable keyboard listener via onPlayPauseRef, no more missed spacebar' },
            { zh: '修复重播卡顿：play effect 用 ref 读取 isVideoEnded，消除 effect 双重触发导致的 rVFC 间隙', en: 'Fix replay stutter: read isVideoEnded from ref to prevent double effect run and rVFC gap' },
            { zh: 'Timeline 进度条可靠同步：每帧 Redux dispatch 保证状态一致，简化架构消除同步 bug', en: 'Reliable timeline sync: per-frame Redux dispatch ensures consistent state, simplified architecture' },
        ]
    },
    {
        version: '1.6.3',
        date: '2026-04-04',
        changes: [
            { zh: '彻底修复批量检测断片：视频模式全帧覆盖，不再依赖选中状态，174/174 帧 0 断片', en: 'Fix batch detection gaps: video mode processes all frames regardless of selection, 174/174 with 0 gaps' },
            { zh: '修复播放时检测框不跟随：onTimeUpdateRef 模式稳定 rVFC 循环，消除每帧重启', en: 'Fix playback box following: onTimeUpdateRef pattern stabilizes rVFC loop, preventing per-frame restarts' },
            { zh: '修复 AI 检测框不显示：批量检测后自动设置 aiLabelsVisible，确保框可见', en: 'Fix AI boxes invisible: auto-set aiLabelsVisible after batch detection via addInferenceHistory' },
            { zh: '修复播放数据过时：EditorModel.latestImagesData 缓存 + fallback，确保立即生效', en: 'Fix stale playback data: EditorModel.latestImagesData cache with fallback for immediate availability' },
            { zh: 'seekVideoToTimeForCapture 增强：readyState 轮询上限 2s，4 次重试，5s 超时保护', en: 'Enhanced seekVideoToTimeForCapture: 2s readyState polling, 4 retries, 5s emergency timeout' },
        ]
    },
    {
        version: '1.6.2',
        date: '2026-04-04',
        changes: [
            { zh: '捕获与推理流水线并行：捕获帧的同时 4 路并发推理，总时间大幅缩短', en: 'Pipeline parallelism: capture and 4-way concurrent inference run simultaneously, greatly reducing total time' },
            { zh: 'seek 改用 requestVideoFrameCallback 确认帧真正渲染后再截图，帧捕获可靠性最大化', en: 'Seek uses requestVideoFrameCallback to confirm actual frame render before capture, maximizing reliability' },
            { zh: '批量写入 Redux：全部推理完成后单次 dispatch 更新所有图像，消除 N 次重渲染', en: 'Batch Redux write: single dispatch after all inference, eliminating N re-renders' },
            { zh: '进度通知实时显示百分比、捕获数、推理数，清晰掌握进度', en: 'Real-time progress with percentage, capture count, and inference count' },
            { zh: '修复 queueMicrotask 导致的批量模式 Redux 数据竞争', en: 'Fix Redux data race in batch mode caused by queueMicrotask async writes' },
        ]
    },
    {
        version: '1.6.1',
        date: '2026-04-04',
        changes: [
            { zh: '推理与渲染分离：播放时直接按帧号读取预计算标注数据，绕过 Redux selector，消除断片', en: 'Decouple inference from rendering: read pre-computed annotation data by frame index during playback, bypass Redux selector, eliminate gaps' },
            { zh: '批量检测增加重试机制和帧就绪等待，确保每帧都能稳定检测', en: 'Batch detection with retry and frame readiness check for reliable per-frame detection' },
            { zh: '视频 seek 增加超时保护和帧解码等待，避免批量检测挂起', en: 'Video seek with timeout protection and frame decode wait to prevent batch detection hangs' },
        ]
    },
    {
        version: '1.6.0',
        date: '2026-04-03',
        changes: [
            { zh: '视频播放时标注框实时同步渲染，无延迟', en: 'Annotation boxes render in real-time during video playback with zero delay' },
            { zh: '修复视频模式检测框坐标偏移（视频模式取消 viewport 边距）', en: 'Fix detection box coordinate misalignment in video mode (remove viewport margin)' },
            { zh: '修复批量检测时所有帧共用同一画面的问题（检测前自动 seek 到对应帧）', en: 'Fix batch detection using same frame for all images (auto-seek to correct frame before capture)' },
            { zh: '批量检测增加重试机制和帧就绪等待，确保不断片', en: 'Batch detection with retry mechanism and frame readiness check to prevent gaps' },
            { zh: '播放时跳过 canvas drawImage 开销，直接显示 video 元素', en: 'Skip canvas drawImage during playback, show video element directly' },
            { zh: '侧边栏更新节流到 5fps，减少播放时 React 重渲染', en: 'Throttle sidebar updates to 5fps during playback to reduce React re-renders' },
            { zh: 'GPU 合成优化：标注层和视频层提升为独立合成器层', en: 'GPU compositing: promote annotation and video layers to separate compositor layers' },
        ]
    },
    {
        version: '1.5.1',
        date: '2026-04-03',
        changes: [
            { zh: '支持批量目标检测：多选图像后点击检测按钮，对所有选中图像依次推理', en: 'Batch object detection: select multiple images then click detect to run inference on all selected' },
            { zh: '已有AI标签的图像自动跳过，避免重复检测', en: 'Skip images with existing AI labels to avoid duplicate detection' },
            { zh: '批量检测实时进度通知和完成汇总统计', en: 'Real-time batch detection progress notification and completion summary' },
        ]
    },
    {
        version: '1.5.0',
        date: '2026-04-03',
        changes: [
            { zh: '视频模式完整支持目标检测：全分辨率截帧发送后端，检测结果与图片模式一致', en: 'Full object detection support in video mode: full-resolution frame capture, results match image mode' },
            { zh: '修复视频模式检测框不渲染问题（Editor 使用全分辨率帧图像而非缩略图）', en: 'Fix detection boxes not rendering in video mode (Editor uses full-res frame instead of thumbnail)' },
            { zh: '切帧后检测框坐标正确对齐视频画面', en: 'Detection box coordinates correctly align with video frame after seeking' },
        ]
    },
    {
        version: '1.4.9',
        date: '2026-04-03',
        changes: [
            { zh: '修复视频模式下目标检测 500 错误（从 canvas 截帧发送，而非发送原始视频文件）', en: 'Fix video mode detection 500 error (send canvas frame instead of raw video file)' },
            { zh: '修复切换图像再切回视频时缩略图转圈圈问题（防止卸载时空缓存覆盖有效缓存）', en: 'Fix video thumbnails spinning on switch back (prevent empty cache overwriting valid cache on unmount)' },
            { zh: '修复 ImagePreview 对视频文件的兼容（跳过无法加载的视频类型文件）', en: 'Fix ImagePreview compatibility with video files (skip unloadable video file types)' },
        ]
    },
    {
        version: '1.4.8',
        date: '2026-04-03',
        changes: [
            { zh: '「导入图像」改为「上传文件」，同时支持上传图像和视频（mp4/mov/avi/webm）', en: '"Import Images" renamed to "Upload Files", now supports both images and videos (mp4/mov/avi/webm)' },
            { zh: '上传的视频文件自动添加到队列，图像直接加入当前项目', en: 'Uploaded videos are added to queue, images are added directly to current project' },
        ]
    },
    {
        version: '1.4.7',
        date: '2026-04-03',
        changes: [
            { zh: '修复矩形框绘制后鼠标松手仍继续绘制的严重 bug（移除未导入的 AISegmentationActions 调用）', en: 'Fix critical bug where rectangle kept drawing after mouse release (removed unimported AISegmentationActions call)' },
            { zh: '恢复矩形绘制引擎核心逻辑与 origin 一致，提升绘制稳定性', en: 'Restore RectRenderEngine core logic to match origin for improved drawing stability' },
        ]
    },
    {
        version: '1.4.6',
        date: '2026-04-02',
        changes: [
            { zh: '缩略图左下角勾标记文件推理状态：推理成功显示绿色勾，未推理显示蓝色勾', en: 'Thumbnail checkbox now indicates inference status: green for inferred, blue for not inferred' },
            { zh: '推理状态颜色采用原版 AI 模式配色（hue-rotate 120deg）', en: 'Inference status color uses original AI mode palette (hue-rotate 120deg)' },
        ]
    },
    {
        version: '1.4.5',
        date: '2026-04-02',
        changes: [
            { zh: '通知弹窗支持实时语言切换（切换语言后通知立即更新）', en: 'Notification popups now update instantly when switching language' },
            { zh: '顶部导航栏"AI Model"按钮文案优化', en: 'Simplified top nav "AI Model" button label' },
            { zh: '中文"队列"改为"文件队列"', en: 'Chinese "Queue" label changed to "File Queue"' },
            { zh: '左右侧边栏按钮间距优化，避免文字重叠', en: 'Improved sidebar button spacing to prevent text overlap' },
        ]
    },
    {
        version: '1.4.4',
        date: '2026-04-02',
        changes: [
            { zh: '全面双语化：修复 40+ 处未国际化的 UI 字符串', en: 'Full i18n: fixed 40+ hardcoded UI strings across the app' },
            { zh: '通知消息支持中英文切换', en: 'Notification messages now support language switching' },
            { zh: '队列面板、视频控件、模型管理弹窗等组件完成双语化', en: 'Queue panel, video controls, model management popup and more are now bilingual' },
            { zh: '消除所有 ternary 语言判断模式，统一使用 LanguageConfig', en: 'Eliminated all ternary language patterns, unified to use LanguageConfig' },
        ]
    },
    {
        version: '1.4.3',
        date: '2026-04-02',
        changes: [
            { zh: '修复模型加载进度条卡在0%的问题（改为后台异步加载）', en: 'Fixed model loading progress stuck at 0% (now loads asynchronously in background)' },
        ]
    },
    {
        version: '1.4.2',
        date: '2026-04-02',
        changes: [
            { zh: '后端新增模型管理API（可用模型列表、模型切换、加载状态查询、自定义模型上传）', en: 'Added backend model management API (available models, model switching, load status, custom model upload)' },
            { zh: '修复前端"模型加载失败"错误（后端缺少 /available-models 等接口）', en: 'Fixed frontend "model load failed" error (backend was missing /available-models endpoints)' },
        ]
    },
    {
        version: '1.4.1',
        date: '2026-04-02',
        changes: [
            { zh: 'Shift 多选后点击第一张红叉可批量删除所有选中图片', en: 'Click delete on first selected image to batch remove all selected images' },
        ]
    },
    {
        version: '1.4.0',
        date: '2026-04-02',
        changes: [
            { zh: '缩略图悬停显示红叉删除按钮', en: 'Show delete button on thumbnail hover' },
            { zh: '统一蓝勾和红叉的大小', en: 'Unified size of selection indicator and delete button' },
        ]
    },
    {
        version: '1.3.7',
        date: '2026-04-02',
        changes: [
            { zh: '修复导航栏按钮 hover 白色背景溢出的问题', en: 'Fixed nav bar button hover background overflowing' },
            { zh: '去除下拉菜单多余间距（顶部和底部）', en: 'Removed extra padding in dropdown menus (top and bottom)' },
        ]
    },
    {
        version: '1.3.6',
        date: '2026-04-02',
        changes: [
            { zh: '推理结果按钮添加图标', en: 'Added icon to inference results button' },
            { zh: '修复底部文件名换行问题', en: 'Fixed filename wrapping in bottom navigation bar' },
        ]
    },
    {
        version: '1.3.5',
        date: '2026-04-02',
        changes: [
            { zh: '左右方向键直接切换上/下一张图片', en: 'ArrowLeft/ArrowRight keys now switch to previous/next image' },
        ]
    },
    {
        version: '1.3.4',
        date: '2026-04-02',
        changes: [
            { zh: '修复项目名称输入框中无法使用方向键和删除键的问题', en: 'Fixed arrow keys and delete key not working inside project name input' },
            { zh: '点击画布自动释放输入框焦点，恢复快捷键', en: 'Clicking canvas auto-blurs input, restoring keyboard shortcuts' },
        ]
    },
    {
        version: '1.3.3',
        date: '2026-04-02',
        changes: [
            { zh: '项目名称在顶部导航栏居中显示', en: 'Project name is now centered in the top navigation bar' },
            { zh: '修复项目名称下划线过长的问题', en: 'Fixed project name underline being wider than the text' },
        ]
    },
    {
        version: '1.3.2',
        date: '2026-04-02',
        changes: [
            { zh: '修复点击画布后空格键触发上传而非播放/暂停的问题', en: 'Fixed Space key triggering upload instead of play/pause after clicking canvas' },
            { zh: '欢迎页面支持点击上传文件', en: 'Welcome page now supports click to upload files' },
        ]
    },
    {
        version: '1.3.1',
        date: '2026-04-01',
        changes: [
            { zh: '修复更新日志展开后窗口变大的问题（展开前锁定高度，改用滚动条）', en: 'Fixed changelog window growing after load more (lock height before expanding, use scrollbar instead)' },
        ]
    },
    {
        version: '1.3.0',
        date: '2026-04-01',
        changes: [
            { zh: '实现文件队列 UI：缩略图列表、状态指示、点击切换文件', en: 'Implemented file queue UI: thumbnail list, status indicators, click to switch files' },
            { zh: '上传新文件自动切换到新内容，无需手动操作', en: 'Auto-switch to newly uploaded content on drop' },
            { zh: '修复拖拽上传在已有图片时被 canvas/Scrollbars 拦截的问题', en: 'Fixed drag-and-drop blocked by canvas/Scrollbars when images are loaded' },
            { zh: '修复切换图集后缩略图转圈不加载的问题', en: 'Fixed thumbnails spinning indefinitely after switching image set' },
            { zh: '修复切换图集后画布灰屏的问题（EditorModel.isLoading 未重置）', en: 'Fixed gray canvas after switching image set (EditorModel.isLoading not reset)' },
            { zh: '修复图片加载失败时 isLoading 永久卡死', en: 'Fixed isLoading stuck on true when image load fails' },
        ]
    },
    {
        version: '1.2.1',
        date: '2026-04-01',
        changes: [
            { zh: '调整模型下拉菜单顺序：本地模型优先，远程模型其次', en: 'Reordered model dropdown: local models first, remote models second' },
            { zh: '移除底部栏"刚刚保存"文字，悬停文件名可查看最后保存时间', en: 'Removed "Just saved" label; hover over filename to see last saved time' },
            { zh: '修复底部栏文件名未居中（左右区域等宽对齐）', en: 'Fixed filename not centered in bottom bar (equal-width left/right sections)' },
        ]
    },
    {
        version: '1.2.0',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频缩略图 URL 内存泄漏', en: 'Fixed video thumbnail URL memory leak' },
            { zh: '修复视频重播竞态条件', en: 'Fixed video replay race condition' },
            { zh: '添加缩略图生成取消机制（切换视频时）', en: 'Added thumbnail generation cancellation on video switch' },
            { zh: '修复播放时 Editor 每帧重新挂载导致卡顿', en: 'Fixed Editor remounting on every frame during playback' },
            { zh: '修复切换视频时缓存误判', en: 'Fixed false cache hit when switching videos' },
            { zh: '修复时间轴标注帧位置计算错误', en: 'Fixed annotated frame position calculation on timeline' },
            { zh: '修复快速拖动时间轴时监听器泄漏', en: 'Fixed seek listener accumulation on rapid scrubbing' },
            { zh: '修复图片预览 Redux 属性直接修改', en: 'Fixed direct prop mutation in ImagePreview' },
        ]
    },
    {
        version: '1.1.6',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频播放到底后需多次点击才能重播', en: 'Fixed replay requiring multiple clicks after video ends' },
        ]
    },
    {
        version: '1.1.5',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频模式光标指示器残留', en: 'Fixed cursor indicator in video mode' },
            { zh: '修复时间轴末尾空白和刷新闪烁', en: 'Fixed timeline gap and flickering at end' },
            { zh: '优化视频帧率检测（元数据快速读取）', en: 'Faster frame rate detection via metadata' },
            { zh: '修复视频总帧数计算偏差', en: 'Fixed total frame count calculation' },
        ]
    },
    {
        version: '1.1.4',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频模式画面叠加问题', en: 'Fixed video mode overlay issue' },
            { zh: '修复视频帧缩略图不加载的问题', en: 'Fixed video frame thumbnail loading' },
            { zh: '优化拖拽上传视觉样式', en: 'Improved drag-and-drop upload visual style' },
        ]
    },
    {
        version: '1.1.2',
        date: '2026-04-01',
        changes: [
            { zh: '添加版本更新日志弹窗', en: 'Added changelog popup' },
            { zh: '点击版本号查看更新历史', en: 'Click version number to view update history' },
        ]
    },
    {
        version: '1.1.1',
        date: '2026-04-01',
        changes: [
            { zh: '添加文件队列管理功能', en: 'Added file queue management' },
            { zh: '支持拖拽上传图片和视频', en: 'Support drag-and-drop upload for images and videos' },
            { zh: '文件缩略图生成与缓存', en: 'File thumbnail generation and caching' },
            { zh: '队列按钮（左侧导航栏）', en: 'Queue button in left sidebar' },
        ]
    },
    {
        version: '1.1.0',
        date: '2026-04-01',
        changes: [
            { zh: '添加视频标注支持', en: 'Added video annotation support' },
            { zh: 'VideoEditor / VideoPlayer / VideoTimeline 组件', en: 'VideoEditor / VideoPlayer / VideoTimeline components' },
            { zh: '视频帧逐帧标注', en: 'Frame-by-frame video annotation' },
            { zh: '时间轴拖动与关键帧标记', en: 'Timeline scrubbing and keyframe marking' },
        ]
    },
    {
        version: '1.0.1',
        date: '2026-03-15',
        changes: [
            { zh: '合并遗留代码功能', en: 'Merged legacy code features' },
        ]
    },
    {
        version: '1.0.0',
        date: '2026-03-01',
        changes: [
            { zh: '初始发布版本', en: 'Initial release' },
        ]
    }
];

interface IProps {
    language: Language;
}

const INITIAL_SHOW_COUNT = 3;

const ChangelogPopup: React.FC<IProps> = ({language}) => {
    const currentTexts = LanguageConfig[language];
    const [status, setMountStatus] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [lockedHeight, setLockedHeight] = useState<number | null>(null);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const isZh = language === Language.CHINESE;

    const handleLoadMore = () => {
        if (bodyRef.current) {
            setLockedHeight(bodyRef.current.offsetHeight);
        }
        setShowAll(true);
    };

    useEffect(() => {
        if (!status) {
            ContextManager.switchCtx(ContextType.POPUP);
            setMountStatus(true);
        }
    }, [status]);

    const onClose = () => {
        PopupActions.close();
    };

    const visibleEntries = showAll ? CHANGELOG_DATA : CHANGELOG_DATA.slice(0, INITIAL_SHOW_COUNT);
    const hasMore = CHANGELOG_DATA.length > INITIAL_SHOW_COUNT;

    const renderContent = () => {
        return (
            <div className="ChangelogContent">
                {visibleEntries.map((entry, idx) => (
                    <div key={entry.version} className={`ChangelogEntry ${idx === 0 ? 'latest' : ''}`}>
                        <div className="EntryHeader">
                            <span className="VersionTag">v{entry.version}</span>
                            <span className="EntryDate">{entry.date}</span>
                        </div>
                        <ul className="ChangesList">
                            {entry.changes.map((change, i) => (
                                <li key={i}>{isZh ? change.zh : change.en}</li>
                            ))}
                        </ul>
                    </div>
                ))}
                {hasMore && !showAll && (
                    <div className="LoadMoreButton" onClick={handleLoadMore}>
                        {isZh ? `加载更多日志 (${CHANGELOG_DATA.length - INITIAL_SHOW_COUNT})` : `Load more (${CHANGELOG_DATA.length - INITIAL_SHOW_COUNT})`}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="ChangelogPopup">
            <div className="ChangelogPanel">
                <div className="PanelHeader">
                    <span className="PanelTitle">{currentTexts.changelog.title}</span>
                    <div className="CloseButton" onClick={onClose}>✕</div>
                </div>
                <div
                    className="PanelBody"
                    ref={bodyRef}
                    style={lockedHeight ? { height: lockedHeight, overflowY: 'auto' } : undefined}
                >
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps)(ChangelogPopup);
