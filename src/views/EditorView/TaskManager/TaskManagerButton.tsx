import React from 'react';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {LanguageConfig, Language} from '../../../data/LanguageConfig';

interface IProps {
    activeCount: number;
    isActive: boolean;
    language: Language;
    onClick: (e: React.MouseEvent) => void;
    buttonRef?: React.RefObject<HTMLDivElement>;
}

const TaskManagerButtonComponent: React.FC<IProps> = ({activeCount, isActive, language, onClick, buttonRef}) => {
    const t = LanguageConfig[language].taskManager;
    const tooltip = t.tooltip.replace('{count}', String(activeCount));
    return (
        <div
            ref={buttonRef}
            className={'TaskManagerButtonBottom' + (isActive ? ' active' : '')}
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
            {activeCount > 0 && <span className='Badge'>{activeCount > 99 ? '99+' : activeCount}</span>}
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    activeCount: state.tasks.tasks.filter(t => t.status === 'running').length,
    language: state.general.language,
});

export const TaskManagerButton = connect(mapStateToProps)(TaskManagerButtonComponent);
