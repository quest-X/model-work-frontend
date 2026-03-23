import React from 'react';
import './FeatureInProgress.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    language: Language;
}

const FeatureInProgress: React.FC<IProps> = ({ language }) => {
    const currentTexts = LanguageConfig[language];
    return(
        <div
            className="FeatureInProgress"
        >
            <img
                draggable={false}
                alt={"take_off"}
                src={"ico/take-off.png"}
            />
            <p className="extraBold">{currentTexts.featureInProgress.newFeature} <br/> {currentTexts.featureInProgress.comingSoon}</p>
        </div>
    )
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps)(FeatureInProgress);