import React, {useEffect, useState} from 'react';
import './KeyboardShortcutsPopup.scss';
import {GenericYesNoPopup} from '../GenericYesNoPopup/GenericYesNoPopup';
import {PopupActions} from '../../../logic/actions/PopupActions';
import {ContextManager} from '../../../logic/hotkey/ContextManager';
import {ContextType} from '../../../data/enums/ContextType';
import {AppState} from '../../../store';
import {connect} from 'react-redux';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {PlatformUtil} from '../../../utils/PlatformUtil';

interface IProps {
    language: Language;
}

const KeyboardShortcutsPopup: React.FC<IProps> = ({language}) => {
    const currentTexts = LanguageConfig[language];
    const [status, setMountStatus] = useState(false);

    useEffect(() => {
        if (!status) {
            ContextManager.switchCtx(ContextType.POPUP);
            setMountStatus(true);
        }
    }, [status]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const onClose = () => {
        PopupActions.close();
    };

    const isMac = PlatformUtil.isMac(window.navigator.userAgent);

    const shortcuts = [
        {
            functionality: currentTexts.keyboardShortcuts.polygonAutocomplete,
            context: currentTexts.keyboardShortcuts.editor,
            mac: 'Enter',
            windows: 'Enter'
        },
        {
            functionality: currentTexts.keyboardShortcuts.cancelPolygonDrawing,
            context: currentTexts.keyboardShortcuts.editor,
            mac: 'Escape',
            windows: 'Escape'
        },
        {
            functionality: currentTexts.keyboardShortcuts.deleteSelectedLabel,
            context: currentTexts.keyboardShortcuts.editor,
            mac: 'Backspace',
            windows: 'Delete'
        },
        {
            functionality: currentTexts.keyboardShortcuts.loadPreviousImage,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌥ + Left',
            windows: 'Ctrl + Left'
        },
        {
            functionality: currentTexts.keyboardShortcuts.loadNextImage,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌥ + Right',
            windows: 'Ctrl + Right'
        },
        {
            functionality: currentTexts.keyboardShortcuts.zoomIn,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌥ + +',
            windows: 'Ctrl + +'
        },
        {
            functionality: currentTexts.keyboardShortcuts.zoomOut,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌥ + -',
            windows: 'Ctrl + -'
        },
        {
            functionality: currentTexts.keyboardShortcuts.switchImage,
            context: currentTexts.keyboardShortcuts.editor,
            mac: 'Left / Right',
            windows: 'Left / Right'
        },
        {
            functionality: currentTexts.keyboardShortcuts.moveImage,
            context: currentTexts.keyboardShortcuts.editor,
            mac: 'Up / Down',
            windows: 'Up / Down'
        },
        {
            functionality: currentTexts.keyboardShortcuts.selectAll,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌘ + A',
            windows: 'Ctrl + A'
        },
        {
            functionality: currentTexts.keyboardShortcuts.save,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌘ + S',
            windows: 'Ctrl + S'
        },
        {
            functionality: currentTexts.keyboardShortcuts.selectLabel,
            context: currentTexts.keyboardShortcuts.editor,
            mac: '⌥ + 0-9',
            windows: 'Ctrl + 0-9'
        },
        {
            functionality: currentTexts.keyboardShortcuts.exitPopup,
            context: currentTexts.keyboardShortcuts.popup,
            mac: 'Escape',
            windows: 'Escape'
        }
    ];

    const renderContent = () => {
        return (
            <div className="KeyboardShortcutsContent">
                <div className="ShortcutsTable">
                    <div className="TableHeader">
                        <div className="HeaderCell functionality">{currentTexts.keyboardShortcuts.functionality}</div>
                        <div className="HeaderCell context">{currentTexts.keyboardShortcuts.context}</div>
                        <div className="HeaderCell shortcut">{isMac ? 'Mac' : 'Windows / Linux'}</div>
                    </div>
                    <div className="TableBody">
                        {shortcuts.map((shortcut, index) => (
                            <div key={index} className="TableRow">
                                <div className="Cell functionality">{shortcut.functionality}</div>
                                <div className="Cell context">{shortcut.context}</div>
                                <div className="Cell shortcut">
                                    <kbd>{isMac ? shortcut.mac : shortcut.windows}</kbd>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="KeyboardShortcutsPopup">
            <GenericYesNoPopup
                title={currentTexts.keyboardShortcuts.title}
                renderContent={renderContent}
                acceptLabel={currentTexts.keyboardShortcuts.close}
                onAccept={onClose}
                skipRejectButton={true}
            />
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps)(KeyboardShortcutsPopup);
