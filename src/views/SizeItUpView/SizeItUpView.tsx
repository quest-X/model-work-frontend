import React from 'react';
import './SizeItUpView.scss';
import {Settings} from "../../settings/Settings";
import {store} from '../../index';
import {LanguageConfig} from '../../data/LanguageConfig';

export const SizeItUpView: React.FC = () => {
    const language = store.getState().general.language;
    const texts = LanguageConfig[language];

    return(<div className="SizeItUpView">
        <p className="extraBold">{texts.sizeItUp.windowTooSmall}</p>
        <img
            draggable={false}
            alt={"small_window"}
            src={"ico/small_window.png"}
        />
        <p className="extraBold">{texts.sizeItUp.minimumSize.replace('{width}', String(Settings.EDITOR_MIN_WIDTH)).replace('{height}', String(Settings.EDITOR_MIN_HEIGHT))}</p>
    </div>)
};