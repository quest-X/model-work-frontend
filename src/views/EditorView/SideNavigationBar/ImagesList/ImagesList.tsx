import React from 'react';
import {connect} from "react-redux";
import {LabelType} from "../../../../data/enums/LabelType";
import {ISize} from "../../../../interfaces/ISize";
import {AppState} from "../../../../store";
import {ImageData, LabelPoint, LabelRect} from "../../../../store/labels/types";
import {VirtualList} from "../../../Common/VirtualList/VirtualList";
import ImagePreview from "../ImagePreview/ImagePreview";
import './ImagesList.scss';
import {ContextManager} from "../../../../logic/context/ContextManager";
import {ContextType} from "../../../../data/enums/ContextType";
import {ImageActions} from "../../../../logic/actions/ImageActions";
import {EventType} from "../../../../data/enums/EventType";
import {LabelStatus} from "../../../../data/enums/LabelStatus";
import {toggleImageSelection, selectImageRange, selectAllImages} from "../../../../store/labels/actionCreators";
import {store} from "../../../../index";

interface IProps {
    activeImageIndex: number;
    imagesData: ImageData[];
    activeLabelType: LabelType;
    imageAIStates: Map<string, any>;
}

interface IState {
    size: ISize;
    isCtrlPressed: boolean;
    isShiftPressed: boolean;
    lastClickedIndex: number | null;
}

class ImagesList extends React.Component<IProps, IState> {
    private imagesListRef: HTMLDivElement;

    constructor(props) {
        super(props);

        this.state = {
            size: null,
            isCtrlPressed: false,
            isShiftPressed: false,
            lastClickedIndex: null,
        }
    }

    public componentDidMount(): void {
        this.updateListSize();
        window.addEventListener(EventType.RESIZE, this.updateListSize);
        window.addEventListener(EventType.KEY_DOWN, this.handleKeyDown);
        window.addEventListener(EventType.KEY_UP, this.handleKeyUp);
    }

    public componentWillUnmount(): void {
        window.removeEventListener(EventType.RESIZE, this.updateListSize);
        window.removeEventListener(EventType.KEY_DOWN, this.handleKeyDown);
        window.removeEventListener(EventType.KEY_UP, this.handleKeyUp);
    }

    private updateListSize = () => {
        if (!this.imagesListRef)
            return;

        const listBoundingBox = this.imagesListRef.getBoundingClientRect();
        this.setState({
            size: {
                width: listBoundingBox.width,
                height: listBoundingBox.height
            }
        })
    };

    private isImageChecked = (index:number): boolean => {
        const imageData = this.props.imagesData[index]
        switch (this.props.activeLabelType) {
            case LabelType.LINE:
                return imageData.labelLines.length > 0
            case LabelType.IMAGE_RECOGNITION:
                return imageData.labelNameIds.length > 0
            case LabelType.POINT:
                return imageData.labelPoints
                    .filter((labelPoint: LabelPoint) => labelPoint.status === LabelStatus.ACCEPTED)
                    .length > 0
            case LabelType.POLYGON:
                return imageData.labelPolygons.length > 0
            case LabelType.RECT:
                return imageData.labelRects
                    .filter((labelRect: LabelRect) => labelRect.status === LabelStatus.ACCEPTED)
                    .length > 0
        }
    };

    private handleKeyDown = (event: KeyboardEvent) => {
        // 输入框中不拦截快捷键
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
            return;
        }

        if (event.ctrlKey || event.metaKey) { // Support both Ctrl and Cmd (for Mac)
            this.setState({ isCtrlPressed: true });

            // Handle Ctrl+A for select all (only when images exist)
            if ((event.key === 'a' || event.key === 'A') && this.props.imagesData.length > 0) {
                event.preventDefault(); // Prevent browser's default select all
                this.handleSelectAll();
                return;
            }
        }
        if (event.shiftKey) {
            this.setState({ isShiftPressed: true });
        }
    };

    private handleKeyUp = (event: KeyboardEvent) => {
        if (!event.ctrlKey && !event.metaKey) {
            this.setState({ isCtrlPressed: false });
        }
        if (!event.shiftKey) {
            this.setState({ isShiftPressed: false });
        }
    };

    private onClickHandler = (index: number) => {
        const imageData = this.props.imagesData[index];
        
        if (this.state.isShiftPressed && this.state.lastClickedIndex !== null) {
            // Shift+click: select range from last clicked to current
            store.dispatch(selectImageRange(this.state.lastClickedIndex, index));
            // Don't change active image during range selection
        } else if (this.state.isCtrlPressed) {
            // Ctrl+click: toggle selection without changing active image
            store.dispatch(toggleImageSelection(imageData.id));
            this.setState({ lastClickedIndex: index });
        } else {
            // Normal click: change active image and clear other selections
            ImageActions.getImageByIndex(index);
            // Clear all selections first, then select only the clicked image
            this.props.imagesData.forEach((img, idx) => {
                if (img.isSelected && idx !== index) {
                    store.dispatch(toggleImageSelection(img.id));
                }
            });
            if (!imageData.isSelected) {
                store.dispatch(toggleImageSelection(imageData.id));
            }
            this.setState({ lastClickedIndex: index });
        }
    };

    private handleSelectAll = () => {
        // Check if all images are currently selected
        const allSelected = this.props.imagesData.every(img => img.isSelected);
        
        // If all are selected, deselect all; otherwise select all
        store.dispatch(selectAllImages(!allSelected));
        
        // Update last clicked index to the last image for potential Shift operations
        if (!allSelected && this.props.imagesData.length > 0) {
            this.setState({ lastClickedIndex: this.props.imagesData.length - 1 });
        }
    };

    private isRangeSelection = (): boolean => {
        // Check if there are consecutive selected images (range selection pattern)
        const selectedIndices = this.props.imagesData
            .map((img, index) => img.isSelected ? index : -1)
            .filter(index => index !== -1)
            .sort((a, b) => a - b);

        if (selectedIndices.length < 2) return false;
        
        // If all images are selected, it's considered a "select all" operation, not range
        const allSelected = selectedIndices.length === this.props.imagesData.length;
        if (allSelected) return false;

        // Check if indices are consecutive (range selection)
        for (let i = 1; i < selectedIndices.length; i++) {
            if (selectedIndices[i] !== selectedIndices[i - 1] + 1) {
                return false;
            }
        }
        return true;
    };

    private getFirstSelectedIndex = (): number => {
        return this.props.imagesData.findIndex((img) => img.isSelected);
    };

    private renderImagePreview = (index: number, isScrolling: boolean, isVisible: boolean, style: React.CSSProperties) => {
        const imageData = this.props.imagesData[index];

        const aiState = this.props.imageAIStates?.get(imageData.id);
        const isInferred = aiState?.inferenceHistory?.some((r: any) => r.success) || false;

        return <ImagePreview
            key={index}
            style={style}
            size={{width: 150, height: 150}}
            isScrolling={isScrolling}
            isChecked={this.isImageChecked(index)}
            isInferred={isInferred}
            imageData={imageData}
            onClick={() => this.onClickHandler(index)}
            isSelected={this.props.activeImageIndex === index}
            isMultiSelected={imageData.isSelected}
            isFirstSelected={imageData.isSelected && index === this.getFirstSelectedIndex()}
        />
    };

    public render() {
        const { size } = this.state;
        return(
            <div
                className="ImagesList"
                ref={ref => this.imagesListRef = ref}
                onClick={() => ContextManager.switchCtx(ContextType.LEFT_NAVBAR)}
            >
                {!!size && <VirtualList
                    size={size}
                    childSize={{width: 150, height: 150}}
                    childCount={this.props.imagesData.length}
                    childRender={this.renderImagePreview}
                    overScanHeight={200}
                />}
            </div>
        )
    }
}

const mapDispatchToProps = {};

const mapStateToProps = (state: AppState) => ({
    activeImageIndex: state.labels.activeImageIndex,
    imagesData: state.labels.imagesData,
    activeLabelType: state.labels.activeLabelType,
    imageAIStates: state.ai.imageAIStates
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ImagesList);