import React from 'react';
import './LoadMoreImagesPopup.scss';
import { AppState } from '../../../store';
import { connect } from 'react-redux';
import { addImageData } from '../../../store/labels/actionCreators';
import { GenericYesNoPopup } from '../GenericYesNoPopup/GenericYesNoPopup';
import { useDropzone } from 'react-dropzone';
import { ImageData } from '../../../store/labels/types';
import { PopupActions } from '../../../logic/actions/PopupActions';
import { ImageDataUtil } from '../../../utils/ImageDataUtil';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';

interface IProps {
    addImageData: (imageData: ImageData[]) => any;
    language: Language;
}

const LoadMoreImagesPopup: React.FC<IProps> = ({ addImageData, language }) => {
    const currentTexts = LanguageConfig[language];
    const { acceptedFiles, getRootProps, getInputProps } = useDropzone({
        accept: {
            'image/*': ['.jpeg', '.png']
        }
    });

    const onAccept = () => {
        if (acceptedFiles.length > 0) {
            addImageData(acceptedFiles.map((fileData: File) => ImageDataUtil.createImageDataFromFileData(fileData)));
            PopupActions.close();
        }
    };

    const onReject = () => {
        PopupActions.close();
    };

    const getDropZoneContent = () => {
        if (acceptedFiles.length === 0)
            return <>
                <input {...getInputProps()} />
                <img
                    draggable={false}
                    alt={'upload'}
                    src={'ico/box-opened.png'}
                />
                <p className='extraBold'>{currentTexts.popups.loadMoreImages.addNewImages}</p>
                <p>{currentTexts.or}</p>
                <p className='extraBold'>{currentTexts.popups.loadMoreImages.clickToSelect}</p>
            </>;
        else if (acceptedFiles.length === 1)
            return <>
                <img
                    draggable={false}
                    alt={'uploaded'}
                    src={'ico/box-closed.png'}
                />
                <p className='extraBold'>{currentTexts.popups.loadMoreImages.oneImageLoaded}</p>
            </>;
        else
            return <>
                <img
                    draggable={false}
                    key={1}
                    alt={'uploaded'}
                    src={'ico/box-closed.png'}
                />
                <p key={2} className='extraBold'>{currentTexts.popups.loadMoreImages.multipleImagesLoaded.replace('{count}', acceptedFiles.length.toString())}</p>
            </>;
    };

    const renderContent = () => {
        return (<div className='LoadMoreImagesPopupContent'>
            <div {...getRootProps({ className: 'DropZone' })}>
                {getDropZoneContent()}
            </div>
        </div>);
    };

    return (
        <GenericYesNoPopup
            title={currentTexts.popups.loadMoreImages.title}
            renderContent={renderContent}
            acceptLabel={currentTexts.popups.loadMoreImages.loadButton}
            disableAcceptButton={acceptedFiles.length < 1}
            onAccept={onAccept}
            rejectLabel={currentTexts.popups.loadMoreImages.cancelButton}
            onReject={onReject}
        />
    );
};

const mapDispatchToProps = {
    addImageData
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LoadMoreImagesPopup);