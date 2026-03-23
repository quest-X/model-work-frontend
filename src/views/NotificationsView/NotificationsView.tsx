import React, {useState, useEffect} from 'react';
import './NotificationsView.scss';
import {AppState} from '../../store';
import {connect} from 'react-redux';
import classNames from 'classnames';
import {deleteNotificationById} from '../../store/notifications/actionCreators';
import {INotification} from '../../store/notifications/types';
import {NotificationType} from '../../data/enums/NotificationType';
import {store} from '../../index';
import {LanguageConfig} from '../../data/LanguageConfig';

interface IProps {
    deleteNotificationByIdAction: (id: string) => void
    queue: INotification[]
}

enum NotificationState {
    IN = 'IN',
    DISPLAY = 'DISPLAY',
    OUT = 'OUT',
    IDLE = 'IDLE'
}

enum Animation {
    IN = 'animation-in',
    DISPLAY = 'animation-display',
    OUT = 'animation-out'
}

const NotificationsView: React.FC<IProps> = (props) => {
    const [ notificationState, setNotificationState ] = useState(NotificationState.IDLE);
    const [ currentTime, setCurrentTime ] = useState(Date.now());

    // 为推理进度通知添加实时计时器更新
    useEffect(() => {
        const notification = props.queue[0];
        if (notification?.isInferenceProgress && notification.startTime) {
            const timer = setInterval(() => {
                setCurrentTime(Date.now());
            }, 1000);
            
            return () => clearInterval(timer);
        }
        return () => {}; // 确保总是返回清理函数
    }, [props.queue]);

    if (props.queue.length > 0 && notificationState === NotificationState.IDLE) {
        setNotificationState(NotificationState.IN)
    }

    const notification: INotification | undefined = props.queue[0]

    const onClose = () => {
        setNotificationState(NotificationState.OUT)
    }

    const onAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
        switch (event.animationName) {
            case Animation.IN:
                setNotificationState(NotificationState.DISPLAY)
                break
            case Animation.DISPLAY:
                setNotificationState(NotificationState.OUT)
                break
            case Animation.OUT:
                props.deleteNotificationByIdAction(notification.id)
                setNotificationState(NotificationState.IDLE)
                break
        }
    }

    const getNotificationWrapperClassName = () => {
        return classNames('notification-wrapper', {
            'in': notificationState === NotificationState.IN,
            'display': notificationState === NotificationState.DISPLAY,
            'out': notificationState === NotificationState.OUT
        })
    }

    const getNotificationClassName = () => {
        return classNames('notification', {
            'error': notification.type === NotificationType.ERROR,
            'success': notification.type === NotificationType.SUCCESS,
            'message': notification.type === NotificationType.MESSAGE,
            'warning': notification.type === NotificationType.WARNING,
            'inference': notification.type === NotificationType.INFERENCE
        })
    }

    const renderNotification = () => {
        // 获取国际化文本
        const language = store.getState().general.language;
        const texts = LanguageConfig[language];
        
        return(
            notification && <div
                className={getNotificationWrapperClassName()}
                key={notification.id}
                onAnimationEnd={onAnimationEnd}
                onClick={!notification.isInferenceProgress ? onClose : undefined}
            >
                <div className={getNotificationClassName()}>
                    <div className='header'>
                        {notification.header}
                    </div>
                    <div className='content'>
                        {notification.isInferenceProgress ? (
                            <div className='inference-progress'>
                                <div className='step-info'>
                                    <div className='step-text'>
                                        {notification.stepDescription}
                                    </div>
                                    <div className='step-counter'>
                                        {(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return texts.aiInference.stepProgress
                                                .replace('{current}', notification.currentStep?.toString() || '1')
                                                .replace('{total}', notification.totalSteps?.toString() || '3');
                                        })()}
                                    </div>
                                </div>
                                <div className='progress-bar'>
                                    <div 
                                        className='progress-fill'
                                        style={{
                                            width: `${(notification.currentStep / notification.totalSteps) * 100}%`
                                        }}
                                    />
                                </div>
                                <div className='steps-list'>
                                    <div className={`step ${notification.currentStep >= 1 ? 'completed' : notification.currentStep === 0 ? 'active' : 'pending'}`}>
                                        <span className='step-name'>{(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return `1. ${texts.aiInference.steps.preprocessing}`;
                                        })()}</span>
                                        {notification.stepTimes?.stepDurations && notification.stepTimes.stepDurations.length > 0 && (
                                            <span className='step-time'>
                                                {(notification.stepTimes.stepDurations[0] / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                    </div>
                                    <div className={`step ${notification.currentStep >= 2 ? 'completed' : notification.currentStep === 1 ? 'active' : 'pending'}`}>
                                        <span className='step-name'>{(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return `2. ${texts.aiInference.steps.inference}`;
                                        })()}</span>
                                        {notification.stepTimes?.stepDurations && notification.stepTimes.stepDurations.length > 1 && (
                                            <span className='step-time'>
                                                {(notification.stepTimes.stepDurations[1] / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                    </div>
                                    <div className={`step ${notification.currentStep >= 3 ? 'completed' : notification.currentStep === 2 ? 'active' : 'pending'}`}>
                                        <span className='step-name'>{(() => {
                                            const language = store.getState().general.language;
                                            const texts = LanguageConfig[language];
                                            return `3. ${texts.aiInference.steps.postprocessing}`;
                                        })()}</span>
                                        {notification.stepTimes?.stepDurations && notification.stepTimes.stepDurations.length > 2 && (
                                            <span className='step-time'>
                                                {(notification.stepTimes.stepDurations[2] / 1000).toFixed(2)}s
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {notification.stepTimes?.totalObjects !== undefined && (
                                    <div className='summary-info'>
                                        <div className='summary-item'>
                                            <span className='summary-label'>{(() => {
                                                const language = store.getState().general.language;
                                                const texts = LanguageConfig[language];
                                                return texts.aiInference.totalTime;
                                            })()}</span>
                                            <span className='summary-value'>
                                                {((currentTime - notification.startTime!) / 1000).toFixed(2)}s
                                            </span>
                                        </div>
                                        <div className='summary-item'>
                                            <span className='summary-label'>{(() => {
                                                const language = store.getState().general.language;
                                                const texts = LanguageConfig[language];
                                                return texts.aiInference.detectedObjects;
                                            })()}</span>
                                            <span className='summary-value'>
                                                {notification.stepTimes.totalObjects} 个
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            notification.description
                        )}
                    </div>
                    <div className='loader'/>
                </div>
            </div>
        )
    }

    return(notificationState !== NotificationState.IDLE ? renderNotification() : null)
}

const mapDispatchToProps = {
    deleteNotificationByIdAction: deleteNotificationById
};

const mapStateToProps = (state: AppState) => ({
    queue: state.notifications.queue
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NotificationsView);
