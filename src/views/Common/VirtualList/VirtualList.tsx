import React from 'react';
import {ISize} from "../../../interfaces/ISize";
import {IRect} from "../../../interfaces/IRect";
import Scrollbars from 'react-custom-scrollbars-2';
import {VirtualListUtil} from "../../../utils/VirtualListUtil";
import {RectUtil} from "../../../utils/RectUtil";

interface IProps {
    size: ISize;
    childCount: number;
    childSize: ISize;
    childRender: (index: number, isScrolling: boolean, isVisible: boolean, style: React.CSSProperties) => React.ReactNode;
    overScanHeight?: number;
}

interface IState {
    viewportRect: IRect;
    isScrolling: boolean;
}

export class VirtualList extends React.Component<IProps, IState> {
    private gridSize: ISize;
    private contentSize: ISize;
    private scrollbars: Scrollbars;

    constructor(props: IProps) {
        super(props);
        this.state = {
            viewportRect: null,
            isScrolling: false
        };
    }

    public componentDidMount(): void {
        const {size, childSize, childCount} = this.props;
        this.calculate(size, childSize, childCount);
        this.setState({
            viewportRect: {
                x: 0,
                y: 0,
                width: this.props.size.width,
                height: this.props.size.height
            }
        });
    }

    public UNSAFE_componentWillUpdate(nextProps: Readonly<IProps>): void {
        const {size, childSize, childCount} = nextProps;
        if (this.props.size.height !== size.height || this.props.size.width !== size.width ||
            this.props.childCount !== childCount || this.props.childSize.width !== childSize.width ||
            this.props.childSize.height !== childSize.height) {
            this.calculate(size, childSize, childCount);
            this.setState({
                viewportRect: {
                    x: this.scrollbars.getValues().scrollLeft,
                    y: this.scrollbars.getValues().scrollTop,
                    width: size.width,
                    height: size.height
                }
            });
        }
    }

    private calculate = (size: ISize, childSize: ISize, childCount: number) => {
        this.gridSize = VirtualListUtil.calculateGridSize(size, childSize, childCount);
        this.contentSize = VirtualListUtil.calculateContentSize(size, childSize, this.gridSize);
    };

    private getVirtualListStyle = ():React.CSSProperties => {
        return {
            position: "relative",
            width: this.props.size.width,
            height: this.props.size.height,
        }
    };

    private getVirtualListContentStyle = ():React.CSSProperties => {
        return {
            width: this.contentSize.width,
            height: this.contentSize.height,
        }
    };

    private onScrollStart = () => {
        this.setState({isScrolling: true});
    };

    private onScrollStop = () => {
        this.setState({isScrolling: false});
    };

    private onScroll = (values) => {
        this.setState({
            viewportRect: {
                x: values.scrollLeft,
                y: values.scrollTop,
                width: this.props.size.width,
                height: this.props.size.height
            }
        });
    };

    private getChildren = () => {
        const {viewportRect, isScrolling} = this.state;
        const {overScanHeight, childSize} = this.props;
        const overScan: number = overScanHeight ? overScanHeight : 0;

        const viewportRectWithOverScan:IRect = {
            x: viewportRect.x,
            y: viewportRect.y - overScan,
            width: viewportRect.width,
            height: viewportRect.height + 2 * overScan
        };

        // Only visit visible rows, including cells touching either viewport edge.
        const columns = this.gridSize.width;
        const firstRow = Math.max(0, Math.ceil(viewportRectWithOverScan.y / childSize.height) - 1);
        const endRow = Math.floor((viewportRectWithOverScan.y + viewportRectWithOverScan.height) / childSize.height) + 1;
        const endIndex = Math.min(this.props.childCount, endRow * columns);
        const margin = (this.contentSize.width - columns * childSize.width) / (columns + 1);
        const children: React.ReactNode[] = [];
        for (let index = firstRow * columns; index < endIndex; index++) {
            const anchor = {
                x: (index % columns) * (margin + childSize.width),
                y: Math.floor(index / columns) * childSize.height,
            };
            const childRect = {...anchor, ...childSize};
            const isVisible = RectUtil.intersect(viewportRectWithOverScan, childRect);

            if (isVisible) {
                const childStyle: React.CSSProperties = {
                    position: "absolute",
                    left: anchor.x,
                    top: anchor.y,
                    width: childSize.width,
                    height: childSize.height
                };

                children.push(this.props.childRender(index, isScrolling, isVisible, childStyle));
            }
        }
        return children;
    };

    public render() {
        const displayContent = !!this.props.size && !!this.props.childSize && !!this.gridSize;

        return(
            <div
                className="VirtualList"
                style={this.getVirtualListStyle()}
            >
                <Scrollbars
                    ref={ref => this.scrollbars = ref}
                    onScrollFrame={this.onScroll}
                    onScrollStart={this.onScrollStart}
                    onScrollStop={this.onScrollStop}
                    autoHide={true}
                >
                    {displayContent && <div
                        className="VirtualListContent"
                        style={this.getVirtualListContentStyle()}
                    >
                        {this.getChildren()}
                    </div>}
                </Scrollbars>
            </div>
        )
    }
}
