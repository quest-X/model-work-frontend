import React, { useState } from 'react';
import './MainView.scss';
import { TextButton } from '../Common/TextButton/TextButton';
import classNames from 'classnames';
import { ISize } from '../../interfaces/ISize';
import { ImageButton } from '../Common/ImageButton/ImageButton';
import { ISocialMedia, SocialMediaData } from '../../data/info/SocialMediaData';
import { EditorFeatureData, IEditorFeature } from '../../data/info/EditorFeatureData';
import { styled, Tooltip, tooltipClasses, TooltipProps } from '@mui/material';
import Fade from '@mui/material/Fade';
import ImagesDropZone from './ImagesDropZone/ImagesDropZone';
import { connect } from 'react-redux';
import { AppState } from '../../store';
import { Language, LanguageConfig } from '../../data/LanguageConfig';

interface IProps {
    language: Language;
}

const MainView: React.FC<IProps> = ({ language }) => {
    const [projectInProgress, setProjectInProgress] = useState(false);
    const [projectCanceled, setProjectCanceled] = useState(false);

    const texts = LanguageConfig[language];

    const startProject = () => {
        setProjectInProgress(true);
    };

    const endProject = () => {
        setProjectInProgress(false);
        setProjectCanceled(true);
    };

    const getClassName = () => {
        return classNames(
            'MainView', {
            'InProgress': projectInProgress,
            'Canceled': !projectInProgress && projectCanceled
        }
        );
    };

    const DarkTooltip = styled(({ className, ...props }: TooltipProps) => (
        <Tooltip {...props} classes={{ popper: className }} />
    ))(({ theme }) => ({
        [`& .${tooltipClasses.tooltip}`]: {
            backgroundColor: '#171717',
            color: '#ffffff',
            boxShadow: theme.shadows[1],
            fontSize: 11,
            maxWidth: 120
        },
    }));

    const getSocialMediaButtons = (size: ISize) => {
        return SocialMediaData.map((data: ISocialMedia, index: number) => {
            return <DarkTooltip
                key={index}
                disableFocusListener={true}
                title={data.tooltipMessage}
                TransitionComponent={Fade}
                TransitionProps={{ timeout: 600 }}
                placement='left'
            >
                <div>
                    <ImageButton
                        buttonSize={size}
                        image={data.imageSrc}
                        imageAlt={data.imageAlt}
                        href={data.href}
                    />
                </div>
            </DarkTooltip>;
        });
    };

    const getEditorFeatureTiles = () => {
        return EditorFeatureData.map((data: IEditorFeature) => {
            return <div
                className='EditorFeaturesTiles'
                key={data.displayText}
            >
                <div
                    className='EditorFeaturesTilesWrapper'
                >
                    <img
                        draggable={false}
                        alt={data.imageAlt}
                        src={data.imageSrc}
                    />
                    <div className='EditorFeatureLabel'>
                        {data.displayText}
                    </div>
                </div>
            </div>;
        });
    };

    return (
        <div className={getClassName()}>
            <div className='Slider' id='lower'>
                <div className='TriangleVertical'>
                    <div className='TriangleVerticalContent' />
                </div>
            </div>

            <div className='Slider' id='upper'>
                <div className='TriangleVertical'>
                    <div className='TriangleVerticalContent' />
                </div>
            </div>

            <div className='LeftColumn'>
                <div className={'LogoWrapper'}>
                    <img
                        draggable={false}
                        alt={'main-logo'}
                        src={'ico/main-image-color.png'}
                    />
                </div>
                <div className='EditorFeaturesWrapper'>
                    {getEditorFeatureTiles()}
                </div>
                <div className='TriangleVertical'>
                    <div className='TriangleVerticalContent' />
                </div>
                {projectInProgress && <TextButton
                    label={texts.mainView.goBack}
                    onClick={endProject}
                />}
            </div>
            <div className='RightColumn'>
                <div />
                <ImagesDropZone />
                <div className='SocialMediaWrapper'>
                    {getSocialMediaButtons({ width: 30, height: 30 })}
                </div>
                {!projectInProgress && <TextButton
                    label={texts.mainView.getStarted}
                    onClick={startProject}
                    externalClassName={'get-started-button'}
                />}
            </div>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps
)(MainView);
