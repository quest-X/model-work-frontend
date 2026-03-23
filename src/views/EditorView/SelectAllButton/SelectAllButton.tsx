import React from 'react';
import './SelectAllButton.scss';
import {connect} from 'react-redux';
import {AppState} from '../../../store';
import {ImageData} from '../../../store/labels/types';
import {Language, LanguageConfig} from '../../../data/LanguageConfig';
import {ImageActions} from '../../../logic/actions/ImageActions';
import {selectAllImages} from '../../../store/labels/actionCreators';

interface IProps {
    imagesData: ImageData[];
    activeImageIndex: number;
    language: Language;
    selectAllImages: (selectAll: boolean) => any;
}

const SelectAllButton: React.FC<IProps> = ({imagesData, activeImageIndex, language, selectAllImages}) => {
    const currentTexts = LanguageConfig[language];
    
    const handleSelectAll = () => {
        // 如果没有图像，不执行任何操作
        if (!imagesData || imagesData.length === 0) {
            return;
        }
        
        // 检查是否所有图像都已选中
        const allSelected = imagesData.every(image => image.isSelected);
        
        // 如果全部选中，则取消选中；否则选中全部
        selectAllImages(!allSelected);
        
        console.log(!allSelected ? '选中全部图像' : '取消选中全部图像', imagesData.length, '张图像');
        console.log('选中状态:', imagesData.map(img => img.isSelected));
    };

    // 检查是否所有图像都已选中来决定按钮文字
    const allSelected = imagesData && imagesData.length > 0 && imagesData.every(image => image.isSelected);
    const buttonText = allSelected ? 
        (language === 'zh' ? '取消全选' : 'Unselect All') : 
        currentTexts.selectAll;

    // 检查是否有任何图像被选中来决定按钮是否显示激活状态
    const hasSelectedImages = imagesData && imagesData.some(image => image.isSelected);
    
    return (
        <div 
            className={`SelectAllButton ${hasSelectedImages ? 'active' : ''}`}
            onClick={handleSelectAll}
            title={buttonText}
        >
            <span>{buttonText}</span>
        </div>
    );
};

const mapStateToProps = (state: AppState) => ({
    imagesData: state.labels.imagesData,
    activeImageIndex: state.labels.activeImageIndex,
    language: state.general.language
});

const mapDispatchToProps = {
    selectAllImages
};

export default connect(mapStateToProps, mapDispatchToProps)(SelectAllButton);
