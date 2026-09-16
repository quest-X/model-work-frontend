import React from 'react';
import classNames from 'classnames'
import './DropDownMenu.scss';
import {getDropDownMenuData} from '../../../../data/info/DropDownMenuData';
import {Language} from '../../../../data/LanguageConfig';

interface IProps {
    language: Language;
    isVisible?: boolean;
    forceDisabled?: boolean;
    allowEngineManagement?: boolean;
}

const DropDownMenu: React.FC<IProps> = ({
    language,
    isVisible = true,
    forceDisabled = false,
    allowEngineManagement = false,
}) => {
    if (!isVisible) return null;
    const disabledTitle = language === Language.CHINESE ? '暂未开放' : 'Not available yet';

    return(<div className='DropDownMenuWrapper'>
        <div className='DropDownMenuContent' style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            height: 40 * getDropDownMenuData(language)[0].children.length
        }}>
            {getDropDownMenuData(language)[0].children.map((element, index) => {
                const disabled = (forceDisabled && !(allowEngineManagement && index === 0)) || element.disabled;
                return <button
                    type='button'
                    className={classNames('DropDownMenuContentOption', {
                        active: !disabled,
                        disabled,
                        divider: element.divider,
                    })}
                    disabled={disabled}
                    title={disabled ? disabledTitle : undefined}
                    onClick={disabled ? undefined : () => {
                        if (element.onClick) element.onClick();
                        // 关闭下拉菜单的逻辑需要在父组件处理
                    }}
                    key={index}
                >
                    <div className='Marker'/>
                    <img src={element.imageSrc} alt={element.imageAlt}/>
                    {element.name}
                </button>
            })}
        </div>
    </div>)
}

export default DropDownMenu;
