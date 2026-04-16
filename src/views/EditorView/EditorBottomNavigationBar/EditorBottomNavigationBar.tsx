import React, { useState, useEffect } from 'react';
import './EditorBottomNavigationBar.scss';
import {ImageData} from "../../../store/labels/types";
import {AppState} from "../../../store";
import {connect} from "react-redux";
import {ImageButton} from "../../Common/ImageButton/ImageButton";
import {ISize} from "../../../interfaces/ISize";
import {ContextType} from "../../../data/enums/ContextType";
import classNames from "classnames";
import {ImageActions} from "../../../logic/actions/ImageActions";
import {Language, LanguageConfig} from "../../../data/LanguageConfig";
import {LocalStorageManager} from "../../../utils/LocalStorageManager";
import { Tooltip } from '@mui/material';

interface IProps {
    size: ISize;
    imageData: ImageData;
    totalImageCount: number;
    activeImageIndex: number;
    activeContext: ContextType;
    language: Language;
}

const EditorBottomNavigationBar: React.FC<IProps> = ({size, imageData, totalImageCount, activeImageIndex, activeContext, language}) => {
    const minWidth:number = 400;
    const [lastSavedTime, setLastSavedTime] = useState<number>(0);
    const currentTexts = LanguageConfig[language];

    useEffect(() => {
        // 获取初始保存时间
        const initialTime = LocalStorageManager.getLastSavedTime();
        setLastSavedTime(initialTime);
        
        // 每5秒更新一次保存时间显示
        const interval = setInterval(() => {
            const currentTime = LocalStorageManager.getLastSavedTime();
            setLastSavedTime(currentTime);
        }, 5000);
        
        return () => clearInterval(interval);
    }, []);

    const truncateFilename = (name: string, maxLen: number): string => {
        if (name.length <= maxLen) return name;
        const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')) : '';
        const base = name.slice(0, name.length - ext.length);
        const keep = maxLen - ext.length - 3; // 3 for "..."
        const head = Math.ceil(keep / 2);
        const tail = Math.floor(keep / 2);
        return base.slice(0, head) + '...' + base.slice(-tail) + ext;
    };

    const getImageCounter = () => {
        return (activeImageIndex + 1) + " / " + totalImageCount;
    };

    const getDetailedSavedTimeTooltip = () => {
        if (lastSavedTime === 0) {
            return language === Language.CHINESE ? '项目尚未保存' : 'Project has not been saved yet';
        }
        
        const date = new Date(lastSavedTime);
        const dateString = date.toLocaleDateString();
        const timeString = date.toLocaleTimeString();
        
        return language === Language.CHINESE 
            ? `最后保存时间：${dateString} ${timeString}`
            : `Last saved: ${dateString} ${timeString}`;
    };

    const getClassName = () => {
        return classNames(
            "EditorBottomNavigationBar",
            {
                "with-context": activeContext === ContextType.EDITOR
            }
        );
    };

    return (
        <div className={getClassName()}>
            <div className="LeftSection">
                <ImageButton
                    image={"ico/left.png"}
                    imageAlt={"previous"}
                    buttonSize={{width: 25, height: 25}}
                    onClick={() => ImageActions.goToPreviousImage()}
                    isDisabled={activeImageIndex === 0}
                    externalClassName={"left"}
                />
            </div>
            
            <div className="CenterSection">
                {size.width > minWidth ?
                    <Tooltip
                        title={imageData.fileData.name}
                        placement="top"
                        arrow
                        enterDelay={500}
                    >
                        <div className="CurrentImageName"> {truncateFilename(imageData.fileData.name, 40)} </div>
                    </Tooltip> :
                    <div className="CurrentImageCount"> {getImageCounter()} </div>
                }
            </div>

            <div className="RightSection">
                <ImageButton
                    image={"ico/right.png"}
                    imageAlt={"next"}
                    buttonSize={{width: 25, height: 25}}
                    onClick={() => ImageActions.goToNextImage()}
                    isDisabled={activeImageIndex === totalImageCount - 1}
                    externalClassName={"right"}
                />
            </div>
        </div>
    );
};

const mapDispatchToProps = {};

const mapStateToProps = (state: AppState) => ({
    activeImageIndex: state.labels.activeImageIndex,
    activeContext: state.general.activeContext,
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditorBottomNavigationBar);
