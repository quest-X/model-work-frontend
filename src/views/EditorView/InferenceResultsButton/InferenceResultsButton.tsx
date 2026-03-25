import React from 'react';
import './InferenceResultsButton.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    language: Language;
    onToggle: () => void;
    isActive: boolean;
}

const InferenceResultsButton: React.FC<IProps> = ({language, onToggle, isActive}) => {
    const currentTexts = LanguageConfig[language];

    const handleClick = () => {
        onToggle();
    };

    return (
        <div
            className={`InferenceResultsButton ${isActive ? 'active' : ''}`}
            onClick={handleClick}
            title={currentTexts.inferenceResults}
        >
            <span>{currentTexts.inferenceResults}</span>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(mapStateToProps)(InferenceResultsButton);
