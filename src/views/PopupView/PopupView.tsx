import React, { useEffect } from 'react';
import './PopupView.scss';
import { PopupWindowType } from '../../data/enums/PopupWindowType';
import { AppState } from '../../store';
import { connect } from 'react-redux';
import { PopupActions } from '../../logic/actions/PopupActions';
import LoadLabelsPopup from './LoadLabelNamesPopup/LoadLabelNamesPopup';
import InsertLabelNamesPopup from './InsertLabelNamesPopup/InsertLabelNamesPopup';
import ExitProjectPopup from './ExitProjectPopup/ExitProjectPopup';
import LoadMoreMediaPopup from './LoadMoreMediaPopup/LoadMoreMediaPopup';
import SuggestLabelNamesPopup from './SuggestLabelNamesPopup/SuggestLabelNamesPopup';
import { CSSHelper } from '../../logic/helpers/CSSHelper';
import { ClipLoader } from 'react-spinners';
import ImportLabelPopup from './ImportLabelPopup/ImportLabelPopup';
import ExportLabelPopup from './ExportLabelsPopup/ExportLabelPopup';
import CallModelPopup from './CallModelPopup/CallModelPopup';
import LoadDetectionModelPopup from './LoadDetectionModelPopup/LoadDetectionModelPopup';
import ConnectInferenceServerPopup from './ConnectInferenceServerPopup/ConnectInferenceServerPopup';
import ModelEnginePopup from './ModelEnginePopup/ModelEnginePopup';
import ManageAIModelsPopup from './ManageAIModelsPopup/ManageAIModelsPopup';
import KeyboardShortcutsPopup from './KeyboardShortcutsPopup/KeyboardShortcutsPopup';
import ChangelogPopup from './ChangelogPopup/ChangelogPopup';
import PipelinePreprocessPopup from './PipelinePopup/PipelinePreprocessPopup';
import PipelineInferencePopup from './PipelinePopup/PipelineInferencePopup';
import PipelinePostprocessPopup from './PipelinePopup/PipelinePostprocessPopup';

interface IProps {
    activePopupType: PopupWindowType;
}

const PopupView: React.FC<IProps> = ({ activePopupType }) => {

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && activePopupType) {
                // Only handle if no other element has already handled the event
                if (!event.defaultPrevented) {
                    event.preventDefault();
                    PopupActions.close();
                }
            }
        };

        // Add event listener when popup is active
        if (activePopupType) {
            // Use capture phase to ensure we handle the event early
            window.addEventListener('keydown', handleKeyDown, true);
        }

        // Cleanup event listener
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [activePopupType]);

    const selectPopup = () => {
        switch (activePopupType) {
            case PopupWindowType.LOAD_LABEL_NAMES:
                return <LoadLabelsPopup />;
            case PopupWindowType.EXPORT_ANNOTATIONS:
                return <ExportLabelPopup />;
            case PopupWindowType.IMPORT_ANNOTATIONS:
                return <ImportLabelPopup />;
            case PopupWindowType.INSERT_LABEL_NAMES:
                return <InsertLabelNamesPopup
                    isUpdate={false}
                />;
            case PopupWindowType.UPDATE_LABEL:
                return <InsertLabelNamesPopup
                    isUpdate={true}
                />;
            case PopupWindowType.EXIT_PROJECT:
                return <ExitProjectPopup />;
            case PopupWindowType.IMPORT_IMAGES:
                return <LoadMoreMediaPopup />;
            case PopupWindowType.CALL_MODEL:
                return <CallModelPopup />;
            case PopupWindowType.LOAD_DETECTION_MODEL:
                return <LoadDetectionModelPopup />;
            case PopupWindowType.CONNECT_AI_MODEL_VIA_API:
                return <ConnectInferenceServerPopup />;
            case PopupWindowType.MODEL_ENGINE:
                return <ModelEnginePopup />;
            case PopupWindowType.MANAGE_AI_MODELS:
                return <ManageAIModelsPopup />;
            case PopupWindowType.SUGGEST_LABEL_NAMES:
                return <SuggestLabelNamesPopup />;
            case PopupWindowType.KEYBOARD_SHORTCUTS:
                return <KeyboardShortcutsPopup />;
            case PopupWindowType.CHANGELOG:
                return <ChangelogPopup />;
            case PopupWindowType.PIPELINE_PREPROCESS:
                return <PipelinePreprocessPopup />;
            case PopupWindowType.PIPELINE_INFERENCE:
                return <PipelineInferencePopup />;
            case PopupWindowType.PIPELINE_POSTPROCESS:
                return <PipelinePostprocessPopup />;
            case PopupWindowType.LOADER:
                return <ClipLoader
                    size={50}
                    color={CSSHelper.getLeadingColor()}
                    loading={true}
                />;
            default:
                return null;
        }
    };

    return (
        activePopupType && <div className='PopupView'>
            {selectPopup()}
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    activePopupType: state.general.activePopupType
});

export default connect(
    mapStateToProps
)(PopupView);
