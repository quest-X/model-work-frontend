import React from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {LanguageConfig, Language} from '../../../data/LanguageConfig';

interface IProps {
    activeCount: number;
    totalCount: number;
    isActive: boolean;
    isPinned?: boolean;
    language: Language;
    onClick: (e: React.MouseEvent) => void;
    buttonRef?: React.RefObject<HTMLDivElement>;
}

const TaskManagerButtonComponent: React.FC<IProps> = ({activeCount, totalCount, isActive, isPinned, language, onClick, buttonRef}) => {
    const t = LanguageConfig[language].taskManager;
    const tooltip = isPinned
        ? (language === 'zh' ? '已固定（双击取消）' : 'Pinned — double-click to unpin')
        : t.tooltip.replace('{count}', String(activeCount));
    const badgeCount = totalCount;
    return (
        <div
            ref={buttonRef}
            className={'TaskManagerButtonBottom' + (isActive ? ' active' : '') + (isPinned ? ' pinned' : '')}
            onClick={onClick}
            title={tooltip}
        >
            <img
                draggable={false}
                alt='task-manager'
                src='ico/tasks.png'
                style={{
                    width: 14, height: 14,
                    filter: 'brightness(0) invert(1)',
                    opacity: isActive || activeCount > 0 ? 1 : 0.6,
                    transition: 'opacity 0.2s ease',
                }}
            />
            {badgeCount > 0 && <span className='Badge'>{badgeCount > 99 ? '99+' : badgeCount}</span>}
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    activeCount: state.tasks.tasks.filter(t => t.status === 'running').length,
    totalCount: state.tasks.tasks.length,
    language: state.general.language,
});

export const TaskManagerButton = connect(mapStateToProps)(TaskManagerButtonComponent);
