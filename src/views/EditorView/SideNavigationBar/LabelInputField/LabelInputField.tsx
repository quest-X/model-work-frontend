import React from 'react';
import {ISize} from '../../../../interfaces/ISize';
import './LabelInputField.scss';
import classNames from 'classnames';
import {ImageButton} from '../../../Common/ImageButton/ImageButton';
import {IRect} from '../../../../interfaces/IRect';
import {IPoint} from '../../../../interfaces/IPoint';
import {RectUtil} from '../../../../utils/RectUtil';
import {AppState} from '../../../../store';
import {connect} from 'react-redux';
import {updateActiveLabelId, updateHighlightedLabelId} from '../../../../store/labels/actionCreators';
import Scrollbars from 'react-custom-scrollbars-2';
import {EventType} from '../../../../data/enums/EventType';
import {LabelName} from '../../../../store/labels/types';
import {LabelsSelector} from '../../../../store/selectors/LabelsSelector';
import {PopupWindowType} from '../../../../data/enums/PopupWindowType';
import {updateActivePopupType} from '../../../../store/general/actionCreators';
import {truncate} from 'lodash';
import { Settings } from '../../../../settings/Settings';
import {Language, LanguageConfig} from '../../../../data/LanguageConfig';

interface IProps {
    size: ISize;
    isActive: boolean;
    isHighlighted: boolean;
    isVisible?: boolean;
    id: string;
    value?: LabelName;
    options: LabelName[];
    onDelete: (id: string) => any;
    onSelectLabel: (labelRectId: string, labelNameId: string) => any;
    updateHighlightedLabelId: (highlightedLabelId: string) => any;
    updateActiveLabelId: (highlightedLabelId: string) => any;
    updateActivePopupType: (activePopupType: PopupWindowType) => any;
    toggleLabelVisibility?: (labelNameId: string) => any;
    language: Language;
}

interface IState {
    animate: boolean;
    isOpen: boolean;
}

class LabelInputField extends React.Component<IProps, IState> {
    private static RECENT_KEY = 'openSight_recentLabels';
    private static MAX_RECENT = 50;

    private static getRecentLabelIds(): string[] {
        try {
            return JSON.parse(localStorage.getItem(LabelInputField.RECENT_KEY) || '[]');
        } catch { return []; }
    }

    private static pushRecentLabelId(id: string): void {
        const recent = LabelInputField.getRecentLabelIds().filter(r => r !== id);
        recent.unshift(id);
        if (recent.length > LabelInputField.MAX_RECENT) recent.length = LabelInputField.MAX_RECENT;
        localStorage.setItem(LabelInputField.RECENT_KEY, JSON.stringify(recent));
    }

    private dropdownOptionHeight: number = 30;
    private dropdownOptionCount: number = 6;
    private dropdownMargin: number = 4;
    private dropdownLabel: HTMLDivElement;
    private dropdown: HTMLDivElement;

    public constructor(props) {
        super(props);
        this.state = {
            animate: false,
            isOpen: false
        }
    }

    public componentDidMount(): void {
        requestAnimationFrame(() => {
            this.setState({ animate: true });
        });
    }

    private getClassName() {
        return classNames(
            'LabelInputField',
            {
                'loaded': this.state.animate,
                'active': this.props.isActive,
                'highlighted': this.props.isHighlighted
            }
        );
    }

    private openDropdown = () => {
        if (LabelsSelector.getLabelNames().length === 0) {
            this.props.updateActivePopupType(PopupWindowType.UPDATE_LABEL);
        } else {
            this.setState({isOpen: true});
            window.addEventListener(EventType.MOUSE_DOWN, this.closeDropdown);
        }
    };

    private closeDropdown = (event: MouseEvent) => {
        const mousePosition: IPoint = {x: event.clientX, y: event.clientY};
        const clientRect = this.dropdown.getBoundingClientRect();
        const dropDownRect: IRect = {
            x: clientRect.left,
            y: clientRect.top,
            width: clientRect.width,
            height: clientRect.height
        };

        if (!RectUtil.isPointInside(dropDownRect, mousePosition)) {
            this.setState({isOpen: false});
            window.removeEventListener(EventType.MOUSE_DOWN, this.closeDropdown)
        }
    };

    private getDropdownStyle = ():React.CSSProperties => {
        const clientRect = this.dropdownLabel.getBoundingClientRect();
        const height: number = Math.min(this.props.options.length, this.dropdownOptionCount) * this.dropdownOptionHeight;
        const style = {
            width: clientRect.width,
            height,
            left: clientRect.left
        };

        if (window.innerHeight * 2/3 < clientRect.top)
            return Object.assign(style, {top: clientRect.top - this.dropdownMargin - height});
        else
            return Object.assign(style, {top: clientRect.bottom + this.dropdownMargin});
    };

    private getDropdownOptions = () => {
        const wrapOnClick = (id: string): (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void => {
            return (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
                this.setState({isOpen: false});
                window.removeEventListener(EventType.MOUSE_DOWN, this.closeDropdown);
                LabelInputField.pushRecentLabelId(id);
                this.props.onSelectLabel(this.props.id, id);
                this.props.updateHighlightedLabelId(null);
                this.props.updateActiveLabelId(this.props.id);
                event.stopPropagation();
            };
        }

        // Count annotations per labelId across all images
        const counts: Record<string, number> = {};
        for (const img of LabelsSelector.getImagesData()) {
            for (const a of [...img.labelRects, ...img.labelPolygons, ...img.labelPoints, ...img.labelLines]) {
                if (a.labelId) counts[a.labelId] = (counts[a.labelId] || 0) + 1;
            }
        }
        const total = Object.values(counts).reduce((s, n) => s + n, 0);

        const recentIds = LabelInputField.getRecentLabelIds();
        const lastUsedId = recentIds.length > 0 ? recentIds[0] : null;
        const lastUsed = lastUsedId ? this.props.options.filter(o => o.id === lastUsedId) : [];
        const rest = [...this.props.options.filter(o => o.id !== lastUsedId)].sort((a, b) => {
            const ai = recentIds.indexOf(a.id);
            const bi = recentIds.indexOf(b.id);
            if (ai !== -1 && bi !== -1) return ai - bi;
            if (ai !== -1) return -1;
            if (bi !== -1) return 1;
            return 0;
        });

        const hasDivider = lastUsed.length > 0 && rest.length > 0;

        const renderOption = (option: LabelName, withDividerBelow = false) => {
            const count = counts[option.id] || 0;
            const pct = total > 0 ? Math.round(count / total * 100) : 0;
            const countLabel = count > 0 ? `(${count}/${total}, ${pct}%)` : null;
            return <div
                className='DropdownOption'
                key={option.id}
                style={{
                    height: this.dropdownOptionHeight,
                    ...(withDividerBelow ? {borderBottom: '1px solid rgba(255,255,255,0.6)'} : {}),
                }}
                onClick={wrapOnClick(option.id)}
            >
                <span>{truncate(option.name, {length: Settings.MAX_DROPDOWN_OPTION_LENGTH})}</span>
                {countLabel && <span className='DropdownOptionCount'>{countLabel}</span>}
            </div>;
        };

        return [
            ...lastUsed.map((opt, i) => renderOption(opt, hasDivider && i === lastUsed.length - 1)),
            ...rest.map(opt => renderOption(opt)),
        ];
    };

    private mouseEnterHandler = () => {
        this.props.updateHighlightedLabelId(this.props.id);
    };

    private mouseLeaveHandler =() => {
        this.props.updateHighlightedLabelId(null);
    };

    private onClickHandler = () => {
        this.props.updateActiveLabelId(this.props.id);
    };

    private getToggleVisibilityButton = (id: string) => {
        if (this.props.toggleLabelVisibility === undefined) {
            return null
        }
        return(
            <ImageButton
                externalClassName={'icon'}
                image={this.props.isVisible ? 'ico/eye.png' : 'ico/hide.png'}
                imageAlt={'label is hidden'}
                buttonSize={{width: 28, height: 28}}
                onClick={() => this.props.toggleLabelVisibility(id)}
            />
        )
    }

    public render() {
        const {size, id, value, onDelete} = this.props;
        return(
            <div
                className={this.getClassName()}
                style={{
                    width: size.width,
                    height: size.height,
                }}
                key={id}
                onMouseEnter={this.mouseEnterHandler}
                onMouseLeave={this.mouseLeaveHandler}
                onClick={this.onClickHandler}
            >
                <div
                    className='LabelInputFieldWrapper'
                    style={{
                        width: size.width,
                        height: size.height,
                    }}
                >
                    <div
                        className='Marker'
                        style={value ? {backgroundColor: value.color} : {}}
                        onClick={(e) => {
                            e.stopPropagation();
                            this.props.updateActivePopupType(PopupWindowType.UPDATE_LABEL);
                        }}
                    />
                    <div className='Content'>
                        <div className='ContentWrapper'>
                            <div className='DropdownLabel'
                                 ref={ref => this.dropdownLabel = ref}
                                 onClick={this.openDropdown}
                            >
                                {value ? truncate(value.name, {length: Settings.MAX_DROPDOWN_OPTION_LENGTH}) : LanguageConfig[this.props.language].selectLabel}
                            </div>
                            {this.state.isOpen && <div
                                className='Dropdown'
                                style={this.getDropdownStyle()}
                                ref={ref => this.dropdown = ref}
                            >
                                <Scrollbars
                                    renderTrackHorizontal={props => <div {...props} className='track-horizontal'/>}
                                >
                                    <div>
                                        {this.getDropdownOptions()}
                                    </div>
                                </Scrollbars>

                            </div>}
                        </div>
                        <div className='ContentWrapper'>
                            {this.getToggleVisibilityButton(id)}
                            <ImageButton
                                externalClassName={'icon'}
                                image={'ico/trash.png'}
                                imageAlt={'remove label'}
                                buttonSize={{width: 28, height: 28}}
                                onClick={() => onDelete(id)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

const mapDispatchToProps = {
    updateHighlightedLabelId,
    updateActiveLabelId,
    updateActivePopupType
};

const mapStateToProps = (state: AppState) => ({
    language: state.general.language
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LabelInputField);
