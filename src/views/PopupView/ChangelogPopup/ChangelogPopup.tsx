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
        version: '1.1.4',
        date: '2026-04-01',
        changes: [
            { zh: '修复视频模式画面叠加问题', en: 'Fixed video mode overlay issue' },
            { zh: '修复视频帧缩略图不加载的问题', en: 'Fixed video frame thumbnail loading' },
            { zh: '修复视频模式光标指示器残留', en: 'Fixed cursor indicator in video mode' },
            { zh: '修复时间轴末尾空白和刷新闪烁', en: 'Fixed timeline gap and flickering at end' },
            { zh: '优化拖拽上传视觉样式', en: 'Improved drag-and-drop upload visual style' },
            { zh: '优化视频帧率检测速度', en: 'Faster video frame rate detection' },
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
    const isZh = language === Language.CHINESE;

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
                    <div className="LoadMoreButton" onClick={() => setShowAll(true)}>
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
                <div className="PanelBody">
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
