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
