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

    const getImageCounter = () => {
        return (activeImageIndex + 1) + " / " + totalImageCount;
    };

    const getLastSavedTimeText = () => {
        if (lastSavedTime === 0) {
            return language === Language.CHINESE ? '未保存' : 'Not saved';
        }
        
        const now = Date.now();
        const diffMs = now - lastSavedTime;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        
        if (diffMins < 1) {
            return language === Language.CHINESE ? '刚刚保存' : 'Just saved';
        }
        if (diffMins < 60) {
            return language === Language.CHINESE ? `${diffMins}分钟前` : `${diffMins}m ago`;
        }
        if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            return language === Language.CHINESE ? `${hours}小时前` : `${hours}h ago`;
        }
        
        const date = new Date(lastSavedTime);
        return date.toLocaleString();
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
                    onClick={() => ImageActions.getPreviousImage()}
                    isDisabled={activeImageIndex === 0}
                    externalClassName={"left"}
                />
            </div>
            
            <div className="CenterSection">
                {size.width > minWidth ?
                    <div className="CurrentImageName"> {imageData.fileData.name} </div> :
                    <div className="CurrentImageCount"> {getImageCounter()} </div>
                }
            </div>
            
            <Tooltip 
                title={getDetailedSavedTimeTooltip()} 
                placement="top"
                arrow
                enterDelay={500}
            >
                <div className="RightSection">
                    <div className="LastSavedTime">
                        {getLastSavedTimeText()}
                    </div>
                    <ImageButton
                        image={"ico/right.png"}
                        imageAlt={"next"}
                        buttonSize={{width: 25, height: 25}}
                        onClick={() => ImageActions.getNextImage()}
                        isDisabled={activeImageIndex === totalImageCount - 1}
                        externalClassName={"right"}
                    />
                </div>
            </Tooltip>
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
