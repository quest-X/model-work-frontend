import React from 'react';
import classNames from 'classnames'
import './DropDownMenu.scss';
import {getDropDownMenuData} from '../../../../data/info/DropDownMenuData';
import {updatePreventCustomCursorStatus} from '../../../../store/general/actionCreators';
import {AppState} from '../../../../store';
import {connect} from 'react-redux';
import {Language} from '../../../../data/LanguageConfig';

interface IProps {
    updatePreventCustomCursorStatusAction: typeof updatePreventCustomCursorStatus;
    language: Language;
    isVisible?: boolean;
}

const DropDownMenu: React.FC<IProps> = ({language, isVisible = true}) => {
    if (!isVisible) return null;

    return(<div className='DropDownMenuWrapper'>
        <div className='DropDownMenuContent' style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            height: 40 * getDropDownMenuData(language)[0].children.length
        }}>
            {getDropDownMenuData(language)[0].children.map((element, index) => {
                return <div className={classNames('DropDownMenuContentOption', 'active', {'divider': element.divider})}
                    onClick={() => {
                        if (element.onClick) element.onClick();
                        // 关闭下拉菜单的逻辑需要在父组件处理
                    }}
                    key={index}
                >
                    <div className='Marker'/>
                    <img src={element.imageSrc} alt={element.imageAlt}/>
                    {element.name}
                </div>
            })}
        </div>
    </div>)
}

const mapDispatchToProps = {
    updatePreventCustomCursorStatusAction: updatePreventCustomCursorStatus,
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DropDownMenu);
