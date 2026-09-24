import React from 'react';
import './ExitProjectPopup.scss';
import { GenericYesNoPopup } from "../GenericYesNoPopup/GenericYesNoPopup";
import {
    updateActiveImageIndex as storeUpdateActiveImageIndex,
    updateActiveLabelNameId as storeUpdateActiveLabelNameId,
    updateFirstLabelCreatedFlag as storeUpdateFirstLabelCreatedFlag,
    updateImageData as storeUpdateImageData,
    updateLabelNames as storeUpdateLabelNames
} from "../../../store/labels/actionCreators";
import { AppState } from "../../../store";
import { connect } from "react-redux";
import { PopupActions } from "../../../logic/actions/PopupActions";
import { updateProjectData as storeUpdateProjectData } from "../../../store/general/actionCreators";
import {Language, LanguageConfig} from "../../../data/LanguageConfig";

interface IProps {
    updateActiveImageIndex: typeof storeUpdateActiveImageIndex;
    updateActiveLabelNameId: typeof storeUpdateActiveLabelNameId;
    updateLabelNames: typeof storeUpdateLabelNames;
    updateImageData: typeof storeUpdateImageData;
    updateFirstLabelCreatedFlag: typeof storeUpdateFirstLabelCreatedFlag;
    updateProjectData: typeof storeUpdateProjectData;
    language: Language;
}

const ExitProjectPopup: React.FC<IProps> = ({
    updateActiveLabelNameId,
    updateLabelNames,
    updateActiveImageIndex,
    updateImageData,
    updateFirstLabelCreatedFlag,
    updateProjectData,
    language
}: IProps) => {
    const currentTexts = LanguageConfig[language];


    const renderContent = () => {
        return (
            <div className="ExitProjectPopupContent">
                <div className="Message">
                    {currentTexts.popups.exitProject.content}
                </div>
            </div>
        );
    };

    const onAccept = () => {
        updateActiveLabelNameId(null);
        updateLabelNames([]);
        updateProjectData({ type: null, name: "default-project" });
        updateActiveImageIndex(null);
        updateImageData([]);
        updateFirstLabelCreatedFlag(false);
        PopupActions.close();
    };

    const onReject = () => {
        PopupActions.close();
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.exitProject.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.exitProject.acceptButton}
            onAccept={onAccept}
            rejectLabel={currentTexts.popups.exitProject.rejectButton}
            onReject={onReject}
        />);
};

const mapDispatchToProps = {
    updateActiveLabelNameId: storeUpdateActiveLabelNameId,
    updateLabelNames: storeUpdateLabelNames,
    updateProjectData: storeUpdateProjectData,
    updateActiveImageIndex: storeUpdateActiveImageIndex,
    updateImageData: storeUpdateImageData,
    updateFirstLabelCreatedFlag: storeUpdateFirstLabelCreatedFlag
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ExitProjectPopup);