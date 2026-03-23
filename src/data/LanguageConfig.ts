export enum Language {
    CHINESE = 'zh',
    ENGLISH = 'en'
}

export interface LanguageTexts {
    // TopNavigationBar
    projectName: string;
    uploadImages: string;
    languageToggle: string;
    
    // EmptyProjectView
    welcomeTitle: string;
    welcomeDescription: string;
    dragActiveMessage: string;
    uploadHints: {
        dragSupport: string;
        formatSupport: string;
        batchSupport: string;
    };
    
    // SideNavigationBar
    images: string;
    labels: string;
    selectAll: string;
    inferenceResults: string;
    
    // EmptyLabelList
    drawFirstBoundingBox: string;
    markFirstPoint: string;
    drawFirstLine: string;
    drawFirstPolygon: string;
    drawFirstLabel: string;
    noLabelsCreated: string;
    
    // EditorBottomNavigationBar
    imageNavigation: {
        previous: string;
        next: string;
        imageCount: string; // "第 {current} 张，共 {total} 张"
    };
    
    // LabelInputField
    selectLabel: string;
    deleteLabel: string;
    toggleVisibility: string;
    
    // Actions DropDown Menu
    actions: {
        title: string;
        editLabels: {
            name: string;
            description: string;
        };
        importImages: {
            name: string;
            description: string;
        };
        importAnnotations: {
            name: string;
            description: string;
        };
        exportAnnotations: {
            name: string;
            description: string;
        };
        runAILocally: {
            name: string;
            description: string;
        };
        connectAIServer: {
            name: string;
            description: string;
        };
        integrateAIModel: {
            name: string;
            description: string;
        };
    };
    
    // Label Toolkit
    labelTypes: {
        all: string;
        imageRecognition: string;
        rect: string;
        point: string;
        line: string;
        polygon: string;
    };
    
    // Popup Windows
    popups: {
        loadMoreImages: {
            title: string;
            addNewImages: string;
            clickToSelect: string;
            oneImageLoaded: string;
            multipleImagesLoaded: string;
            loadButton: string;
            cancelButton: string;
        };
        insertLabelNames: {
            titleCreate: string;
            titleUpdate: string;
            acceptButton: string;
            rejectButton: string;
            insertLabel: string;
            addLabel: string;
            suggestion: string;
            loadFromFile: string;
            messageUpdate: string;
            messageCreate: string;
            emptyListMessage: string;
        };
        exportAnnotations: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            selectFormat: string;
        };
        importAnnotations: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            selectFileFormat: string;
            dropZoneMessage: string;
            dropZoneActive: string;
            importError: string;
            tryAgain: string;
            importReady: string;
            importWarning: string;
        };
        exitProject: {
            title: string;
            content: string;
            acceptButton: string;
            rejectButton: string;
        };
        loadModel: {
            title: string;
            selectModel: string;
            acceptButton: string;
            rejectButton: string;
            models: {
                yolov5: string;
                ssd: string;
                posenet: string;
            };
            welcomeMessage: string;
        };
        suggestLabels: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            selectAll: string;
            acceptAll: string;
            rejectAll: string;
        };
        connectServer: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            roboflowModel: string;
            roboflowKey: string;
            testConnection: string;
            roboflowMessage: string;
            modelServiceUrl: string;
            modelTaskType: string;
            modelApiKey: string;
            taskTypeDetection: string;
            taskTypeSegmentation: string;
            customAIMessage: string;
        };
        integrateModel: {
            title: string;
            acceptButton: string;
            rejectButton: string;
            modelUrl: string;
            modelType: string;
            apiKey: string;
            testConnection: string;
            integrationMessage: string;
            taskTypeDetection: string;
            taskTypeSegmentation: string;
        };
    };
    
    // Format Options
    formats: {
        export: {
            yoloRect: string;
            vocRect: string;
            csvGeneric: string;
            vggPolygon: string;
            cocoPolygon: string;
            jsonImageRecognition: string;
        };
        import: {
            cocoRect: string;
            cocoPolygon: string;
            yoloRect: string;
            vocRect: string;
        };
    };
    
    // Feature In Progress
    featureInProgress: {
        newFeature: string;
        comingSoon: string;
    };
    
    // Editor Top Navigation Bar
    editorTopNavBar: {
        zoomIn: string;
        zoomOut: string;
        fitImage: string;
        maxZoom: string;
        imageDragModeOn: string;
        imageDragModeOff: string;
        crossHairOn: string;
        crossHairOff: string;
        acceptAllDetections: string;
        rejectAllDetections: string;
        enableSegmentation: string;
        disableSegmentation: string;
        segmentationInProgress: string;
        enableDetection: string;
        disableDetection: string;
        detectionInProgress: string;
        cannotSegment: string;
        cannotDetect: string;
    };
    
    // Keyboard Shortcuts Popup
    keyboardShortcuts: {
        title: string;
        close: string;
        functionality: string;
        context: string;
        editor: string;
        popup: string;
        polygonAutocomplete: string;
        cancelPolygonDrawing: string;
        deleteSelectedLabel: string;
        loadPreviousImage: string;
        loadNextImage: string;
        zoomIn: string;
        zoomOut: string;
        moveImage: string;
        selectLabel: string;
        exitPopup: string;
    };
    
    // Common
    makeSense: string;
    ok: string;
    cancel: string;
    delete: string;
    edit: string;
    save: string;
    load: string;
    export: string;
    import: string;
    or: string;
    
    // AI Inference Notifications
    aiInference: {
        inProgress: string;
        completed: string;
        failed: string;
        steps: {
            preprocessing: string;
            inference: string;
            postprocessing: string;
        };
        stepProgress: string; // "步骤 {current}/{total}"
        totalTime: string; // "总耗时："
        detectedObjects: string; // "检测物体："
        completedStep: string; // "推理完成"
        successMessage: string; // "成功检测 {count} 个任务，总耗时 {time}s"
        failedMessage: string;
        results: {
            title: string; // "推理结果"
            noResults: string; // "暂无推理结果"
            noResultsHint: string; // "绘制标注框后将自动触发AI推理"
            confidence: string; // "置信度"
            coordinates: string; // "坐标"
            size: string; // "大小"
            area: string; // "面积"
            thumbnail: string; // "缩略图"
            objectId: string; // "对象ID"
        };
    };
}

export const LanguageConfig: Record<Language, LanguageTexts> = {
    [Language.CHINESE]: {
        // TopNavigationBar
        projectName: '项目名称:',
        uploadImages: '上传图像',
        languageToggle: '中文',
        
        // EmptyProjectView
        welcomeTitle: '欢迎使用 Make Sense',
        welcomeDescription: '请拖拽图像到此处或点击上传',
        dragActiveMessage: '释放文件以上传图像',
        uploadHints: {
            dragSupport: '• 支持拖拽上传图像文件',
            formatSupport: '• 支持 JPEG、PNG 格式',
            batchSupport: '• 可以批量上传多张图像'
        },
        
        // SideNavigationBar
        images: '图像',
        labels: '标签',
        selectAll: '选中全部',
        inferenceResults: '推理结果',
        
        // EmptyLabelList
        drawFirstBoundingBox: '绘制第一个边界框',
        markFirstPoint: '标记第一个点',
        drawFirstLine: '绘制第一条线',
        drawFirstPolygon: '绘制第一个多边形',
        drawFirstLabel: '绘制第一个标签',
        noLabelsCreated: '尚未为此图像创建标签',
        
        // EditorBottomNavigationBar
        imageNavigation: {
            previous: '上一张',
            next: '下一张',
            imageCount: '第 {current} 张，共 {total} 张'
        },
        
        // LabelInputField
        selectLabel: '选择标签',
        deleteLabel: '删除标签',
        toggleVisibility: '切换可见性',
        
        // Actions DropDown Menu
        actions: {
            title: '操作',
            editLabels: {
                name: '编辑标签',
                description: '修改标签列表'
            },
            importImages: {
                name: '导入图像',
                description: '加载更多图像'
            },
            importAnnotations: {
                name: '导入标注',
                description: '从文件导入标注'
            },
            exportAnnotations: {
                name: '导出标注',
                description: '导出标注到文件'
            },
            runAILocally: {
                name: '本地运行AI',
                description: '在浏览器中运行标注模型'
            },
            connectAIServer: {
                name: '连接AI服务器',
                description: '在服务器上运行标注模型'
            },
            integrateAIModel: {
                name: '管理模型',
                description: '集成外部AI模型服务'
            }
        },
        
        // Label Toolkit
        labelTypes: {
            all: '全部标签',
            imageRecognition: '图像识别',
            rect: '矩形框',
            point: '点',
            line: '线条',
            polygon: '多边形'
        },
        
        // Popup Windows
        popups: {
            loadMoreImages: {
                title: '加载更多图像',
                addNewImages: '添加新图像',
                clickToSelect: '点击此处选择图像',
                oneImageLoaded: '已加载 1 张新图像',
                multipleImagesLoaded: '已加载 {count} 张新图像',
                loadButton: '加载',
                cancelButton: '取消'
            },
        insertLabelNames: {
            titleCreate: '创建标签列表',
            titleUpdate: '更新标签列表',
            acceptButton: '创建项目',
            rejectButton: '取消',
            insertLabel: '输入标签',
            addLabel: '添加标签',
            suggestion: '建议',
            loadFromFile: '从文件加载',
            messageUpdate: '您现在可以编辑用于描述照片中对象的标签名称。使用 + 按钮添加新的空文本字段。',
            messageCreate: '在开始之前，您可以创建计划分配给项目中对象的标签列表。您也可以选择暂时跳过这一部分，在进行过程中定义标签名称。',
            emptyListMessage: '点击此处添加第一个标签'
        },
            exportAnnotations: {
                title: '导出标注',
                acceptButton: '导出',
                rejectButton: '取消',
                selectFormat: '选择您要用于导出标注的文件格式。'
            },
            importAnnotations: {
                title: '导入标注',
                acceptButton: '导入',
                rejectButton: '取消',
                selectFileFormat: '选择您要用于导入标签的文件格式。',
                dropZoneMessage: '拖拽标注文件到此处',
                dropZoneActive: '释放文件以导入标注',
                importError: '标注导入失败',
                tryAgain: '请重试',
                importReady: '标注已准备好导入',
                importWarning: '导入后您将丢失所有当前标注'
            },
            exitProject: {
                title: '退出项目',
                content: '您确定要退出当前项目吗？所有未保存的更改将丢失。',
                acceptButton: '退出',
                rejectButton: '取消'
            },
            loadModel: {
                title: '加载AI模型',
                selectModel: '选择要加载的模型：',
                acceptButton: '加载',
                rejectButton: '取消',
                models: {
                    yolov5: 'YOLOv5 - 使用矩形框进行目标检测',
                    ssd: 'COCO SSD - 使用矩形框进行目标检测',
                    posenet: 'POSE-NET - 使用点进行姿态估计'
                },
                welcomeMessage: '使用AI加速标注过程。别担心，照片仍然安全。为了保护隐私，我们决定不将图像发送到服务器，而是将AI带给您。请确保您有快速稳定的连接 - 加载模型可能需要一些时间。'
            },
            suggestLabels: {
                title: '建议标签',
                acceptButton: '接受选中',
                rejectButton: '取消',
                selectAll: '全选',
                acceptAll: '接受全部',
                rejectAll: '拒绝全部'
            },
            connectServer: {
                title: '连接AI服务器',
                acceptButton: '连接',
                rejectButton: '取消',
                roboflowModel: 'Roboflow 模型ID',
                roboflowKey: 'Roboflow API密钥',
                testConnection: '测试连接',
                roboflowMessage: '提供您要通过API运行的Roboflow模型的详细信息以及API密钥。',
                modelServiceUrl: '模型服务地址',
                modelTaskType: '模型任务类型',
                modelApiKey: '模型接口密钥',
                taskTypeDetection: '目标检测',
                taskTypeSegmentation: '目标分割',
                customAIMessage: '配置您的AI模型服务连接信息'
            },
            integrateModel: {
                title: '接入AI模型',
                acceptButton: '接入',
                rejectButton: '取消',
                modelUrl: '模型地址',
                modelType: '模型类型',
                apiKey: '模型密钥',
                testConnection: '测试连接',
                integrationMessage: '配置您要接入的外部AI模型服务的详细信息。模型地址和模型类型是必填项，模型密钥为可选项。',
                taskTypeDetection: '目标检测',
                taskTypeSegmentation: '目标分割'
            }
        },
        
        // Format Options
        formats: {
            export: {
                yoloRect: '包含YOLO格式文件的.zip压缩包。',
                vocRect: '包含VOC XML格式文件的.zip压缩包。',
                csvGeneric: '单个CSV文件。',
                vggPolygon: 'VGG JSON格式的单个文件。',
                cocoPolygon: 'COCO JSON格式的单个文件。',
                jsonImageRecognition: '单个JSON文件。'
            },
            import: {
                cocoRect: 'COCO JSON格式的单个文件。',
                cocoPolygon: 'COCO JSON格式的单个文件。',
                yoloRect: 'YOLO格式的多个文件以及标签名称定义 - labels.txt文件。',
                vocRect: 'VOC XML格式的多个文件。'
            }
        },
        
        // Feature In Progress
        featureInProgress: {
            newFeature: '新功能',
            comingSoon: '即将推出...'
        },
        
        // Editor Top Navigation Bar
        editorTopNavBar: {
            zoomIn: '放大',
            zoomOut: '缩小',
            fitImage: '适应图像到可用空间',
            maxZoom: '最大允许图像缩放',
            imageDragModeOn: '开启拖拽',
            imageDragModeOff: '关闭拖拽',
            crossHairOn: '开启标注', 
            crossHairOff: '关闭标注',
            acceptAllDetections: '接受所有建议的检测',
            rejectAllDetections: '拒绝所有建议的检测',
            enableSegmentation: '开启分割',
            disableSegmentation: '关闭分割',
            segmentationInProgress: '分割中...',
            enableDetection: '开启检测',
            disableDetection: '关闭检测',
            detectionInProgress: '检测中...',
            cannotSegment: '无法分割',
            cannotDetect: '无法检测'
        },
        
        // Keyboard Shortcuts Popup
        keyboardShortcuts: {
            title: '键盘快捷键',
            close: '关闭',
            functionality: '功能',
            context: '环境',
            editor: '编辑器',
            popup: '弹窗',
            polygonAutocomplete: '多边形自动完成',
            cancelPolygonDrawing: '取消多边形绘制',
            deleteSelectedLabel: '删除选中的标签',
            loadPreviousImage: '加载上一张图像',
            loadNextImage: '加载下一张图像',
            zoomIn: '放大',
            zoomOut: '缩小',
            moveImage: '移动图像',
            selectLabel: '选择标签',
            exitPopup: '退出弹窗'
        },
        
        // Common
        makeSense: 'OpenSight Platform',
        ok: '确定',
        cancel: '取消',
        delete: '删除',
        edit: '编辑',
        save: '保存',
        load: '加载',
        export: '导出',
        import: '导入',
        or: '或者',
        
        // AI Inference Notifications
        aiInference: {
            inProgress: 'AI推理中',
            completed: '推理完成',
            failed: '推理失败',
            steps: {
                preprocessing: '预处理',
                inference: '推理过程',
                postprocessing: '后处理'
            },
            stepProgress: '步骤 {current}/{total}',
            totalTime: '总耗时：',
            detectedObjects: '检测物体：',
            completedStep: '推理完成',
            successMessage: '成功检测 {count} 个任务，总耗时 {time}s',
            failedMessage: '分割推理过程中发生错误，请重试',
            results: {
                title: '推理结果',
                noResults: '暂无推理结果',
                noResultsHint: '绘制标注框后将自动触发AI推理',
                confidence: '置信度',
                coordinates: '坐标',
                size: '大小',
                area: '面积',
                thumbnail: '缩略图',
                objectId: '对象ID'
            }
        }
    },
    [Language.ENGLISH]: {
        // TopNavigationBar
        projectName: 'Project Name:',
        uploadImages: 'Upload Images',
        languageToggle: 'English',
        
        // EmptyProjectView
        welcomeTitle: 'Welcome to Make Sense',
        welcomeDescription: 'Drag images here or click to upload',
        dragActiveMessage: 'Drop files to upload images',
        uploadHints: {
            dragSupport: '• Support drag and drop image files',
            formatSupport: '• Support JPEG, PNG formats',
            batchSupport: '• Support batch upload multiple images'
        },
        
        // SideNavigationBar
        images: 'Images',
        labels: 'Labels',
        selectAll: 'Select All',
        inferenceResults: 'AI Results',
        
        // EmptyLabelList
        drawFirstBoundingBox: 'draw your first bounding box',
        markFirstPoint: 'mark your first point',
        drawFirstLine: 'draw your first line',
        drawFirstPolygon: 'draw your first polygon',
        drawFirstLabel: 'draw your first label',
        noLabelsCreated: 'no labels created for this image yet',
        
        // EditorBottomNavigationBar
        imageNavigation: {
            previous: 'Previous',
            next: 'Next',
            imageCount: 'Image {current} of {total}'
        },
        
        // LabelInputField
        selectLabel: 'Select Label',
        deleteLabel: 'Delete Label',
        toggleVisibility: 'Toggle Visibility',
        
        // Actions DropDown Menu
        actions: {
            title: 'Actions',
            editLabels: {
                name: 'Edit Labels',
                description: 'Modify labels list'
            },
            importImages: {
                name: 'Import Images',
                description: 'Load more images'
            },
            importAnnotations: {
                name: 'Import Annotations',
                description: 'Import annotations from file'
            },
            exportAnnotations: {
                name: 'Export Annotations',
                description: 'Export annotations to file'
            },
            runAILocally: {
                name: 'Run AI locally',
                description: 'Run annotation model in browser'
            },
            connectAIServer: {
                name: 'Connect AI server',
                description: 'Run annotation model on server'
            },
            integrateAIModel: {
                name: 'Integrate AI Model',
                description: 'Integrate external AI model services'
            }
        },
        
        // Label Toolkit
        labelTypes: {
            all: 'All Labels',
            imageRecognition: 'Image recognition',
            rect: 'Rect',
            point: 'Point',
            line: 'Line',
            polygon: 'Polygon'
        },
        
        // Popup Windows
        popups: {
            loadMoreImages: {
                title: 'Load more images',
                addNewImages: 'Add new images',
                clickToSelect: 'Click here to select them',
                oneImageLoaded: '1 new image loaded',
                multipleImagesLoaded: '{count} new images loaded',
                loadButton: 'Load',
                cancelButton: 'Cancel'
            },
        insertLabelNames: {
            titleCreate: 'Create labels list',
            titleUpdate: 'Update labels list',
            acceptButton: 'Start project',
            rejectButton: 'Cancel',
            insertLabel: 'Insert label',
            addLabel: 'Add label',
            suggestion: 'Suggestion',
            loadFromFile: 'Load from file',
            messageUpdate: 'You can now edit the label names you use to describe the objects in the photos. Use the + button to add a new empty text field.',
            messageCreate: 'Before you start, you can create a list of labels you plan to assign to objects in your project. You can also choose to skip that part for now and define label names as you go.',
            emptyListMessage: 'Click here to add your first label'
        },
            exportAnnotations: {
                title: 'Export annotations',
                acceptButton: 'Export',
                rejectButton: 'Cancel',
                selectFormat: 'Select file format you would like to use to export annotations.'
            },
            importAnnotations: {
                title: 'Import annotations',
                acceptButton: 'Import',
                rejectButton: 'Cancel',
                selectFileFormat: 'Select file format you would like to use to import labels.',
                dropZoneMessage: 'Drop annotation files here',
                dropZoneActive: 'Release files to import annotations',
                importError: 'Annotation import was unsuccessful',
                tryAgain: 'Try again',
                importReady: 'Annotation ready for import',
                importWarning: 'After import you will lose all your current annotations'
            },
            exitProject: {
                title: 'Exit project',
                content: 'Are you sure you want to exit the current project? All unsaved changes will be lost.',
                acceptButton: 'Exit',
                rejectButton: 'Cancel'
            },
            loadModel: {
                title: 'Load AI Model',
                selectModel: 'Select model to load:',
                acceptButton: 'Load',
                rejectButton: 'Cancel',
                models: {
                    yolov5: 'YOLOv5 - object detection using rectangles',
                    ssd: 'COCO SSD - object detection using rectangles',
                    posenet: 'POSE-NET - pose estimation using points'
                },
                welcomeMessage: 'Speed up your annotation process using AI. Don\'t worry, your photos are still safe. To take care of your privacy, we decided not to send your images to the server, but instead bring AI to you. Make sure that you have a fast and stable connection - it may take a while to load the model.'
            },
            suggestLabels: {
                title: 'Suggest Labels',
                acceptButton: 'Accept Selected',
                rejectButton: 'Cancel',
                selectAll: 'Select All',
                acceptAll: 'Accept All',
                rejectAll: 'Reject All'
            },
            connectServer: {
                title: 'Connect AI Server',
                acceptButton: 'Connect',
                rejectButton: 'Cancel',
                roboflowModel: 'Roboflow Model ID',
                roboflowKey: 'Roboflow API Key',
                testConnection: 'Test Connection',
                roboflowMessage: 'Provide details of the Roboflow model you want to run over the API, as well as your API key.',
                modelServiceUrl: 'Model Service URL',
                modelTaskType: 'Model Task Type',
                modelApiKey: 'Model API Key',
                taskTypeDetection: 'Object Detection',
                taskTypeSegmentation: 'Object Segmentation',
                customAIMessage: 'Configure your AI model service connection'
            },
            integrateModel: {
                title: 'Integrate AI Model',
                acceptButton: 'Integrate',
                rejectButton: 'Cancel',
                modelUrl: 'Model URL',
                modelType: 'Model Type',
                apiKey: 'Model Key',
                testConnection: 'Test Connection',
                integrationMessage: 'Configure the details of the external AI model service you want to integrate. Model URL and model type are required, model key is optional.',
                taskTypeDetection: 'Object Detection',
                taskTypeSegmentation: 'Object Segmentation'
            }
        },
        
        // Format Options
        formats: {
            export: {
                yoloRect: 'A .zip package containing files in YOLO format.',
                vocRect: 'A .zip package containing files in VOC XML format.',
                csvGeneric: 'Single CSV file.',
                vggPolygon: 'Single file in VGG JSON format.',
                cocoPolygon: 'Single file in COCO JSON format.',
                jsonImageRecognition: 'Single JSON file.'
            },
            import: {
                cocoRect: 'Single file in COCO JSON format.',
                cocoPolygon: 'Single file in COCO JSON format.',
                yoloRect: 'Multiple files in YOLO format along with labels names definition - labels.txt file.',
                vocRect: 'Multiple files in VOC XML format.'
            }
        },
        
        // Feature In Progress
        featureInProgress: {
            newFeature: 'new feature',
            comingSoon: 'coming soon...'
        },
        
        // Editor Top Navigation Bar
        editorTopNavBar: {
            zoomIn: 'zoom in',
            zoomOut: 'zoom out',
            fitImage: 'fit image to available space',
            maxZoom: 'maximum allowed image zoom',
            imageDragModeOn: 'Enable Drag',
            imageDragModeOff: 'Disable Drag',
            crossHairOn: 'Enable Annotation',
            crossHairOff: 'Disable Annotation',
            acceptAllDetections: 'accept all proposed detections',
            rejectAllDetections: 'reject all proposed detections',
            enableSegmentation: 'Enable Segmentation',
            disableSegmentation: 'Disable Segmentation',
            segmentationInProgress: 'Segmentation in progress...',
            enableDetection: 'Enable Detection',
            disableDetection: 'Disable Detection',
            detectionInProgress: 'Detection in progress...',
            cannotSegment: 'Cannot Segment',
            cannotDetect: 'Cannot Detect'
        },
        
        // Keyboard Shortcuts Popup
        keyboardShortcuts: {
            title: 'Keyboard Shortcuts',
            close: 'Close',
            functionality: 'Functionality',
            context: 'Context',
            editor: 'Editor',
            popup: 'Popup',
            polygonAutocomplete: 'Polygon autocomplete',
            cancelPolygonDrawing: 'Cancel polygon drawing',
            deleteSelectedLabel: 'Delete currently selected label',
            loadPreviousImage: 'Load previous image',
            loadNextImage: 'Load next image',
            zoomIn: 'Zoom in',
            zoomOut: 'Zoom out',
            moveImage: 'Move image',
            selectLabel: 'Select Label',
            exitPopup: 'Exit popup'
        },
        
        // Common
        makeSense: 'OpenSight Platform',
        ok: 'OK',
        cancel: 'Cancel',
        delete: 'Delete',
        edit: 'Edit',
        save: 'Save',
        load: 'Load',
        export: 'Export',
        import: 'Import',
        or: 'or',
        
        // AI Inference Notifications
        aiInference: {
            inProgress: 'AI Inference',
            completed: 'Inference Completed',
            failed: 'Inference Failed',
            steps: {
                preprocessing: 'Preprocessing',
                inference: 'Inference',
                postprocessing: 'Post-processing'
            },
            stepProgress: 'Step {current}/{total}',
            totalTime: 'Total Time:',
            detectedObjects: 'Detected:',
            completedStep: 'Completed',
            successMessage: 'Successfully detected {count} objects, total time {time}s',
            failedMessage: 'An error occurred during segmentation inference, please try again',
            results: {
                title: 'Inference Results',
                noResults: 'No inference results',
                noResultsHint: 'Draw annotation boxes to trigger AI inference',
                confidence: 'Confidence',
                coordinates: 'Coordinates',
                size: 'Size',
                area: 'Area',
                thumbnail: 'Thumbnail',
                objectId: 'Object ID'
            }
        }
    }
};
