import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Language} from '../../../../data/LanguageConfig';
import {DatasetExportSelection} from '../../../../services/DatasetActionSelection';
import {PopupActions} from '../../../../logic/actions/PopupActions';
import {DatasetExportPopup} from '../DatasetExportPopup';

jest.mock('../../GenericYesNoPopup/GenericYesNoPopup', () => ({
    GenericYesNoPopup: ({title, renderContent, acceptLabel, onAccept, rejectLabel, onReject}: any) => <div>
        <h1>{title}</h1>
        {renderContent()}
        <button onClick={onAccept}>{acceptLabel}</button>
        <button onClick={onReject}>{rejectLabel}</button>
    </div>,
}));

jest.mock('../../../../services/DatasetActionSelection', () => ({
    DatasetExportSelection: {get: jest.fn(), set: jest.fn()},
}));

jest.mock('../../../../logic/actions/PopupActions', () => ({
    PopupActions: {close: jest.fn()},
}));

jest.mock('../../../../utils/DefaultBackendUrl', () => ({
    getEngineBaseUrl: () => 'https://core.test/core_service',
}));

describe('DatasetExportPopup', () => {
    it('confirms the selected revision before starting the zip download', () => {
        (DatasetExportSelection.get as jest.Mock).mockReturnValue({
            id: 'dataset-1',
            name: 'default-project',
            revision: 4,
            imageCount: 465,
            classCount: 1,
        });
        const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        render(<DatasetExportPopup language={Language.CHINESE} />);

        expect(screen.getByText('default-project')).toBeInTheDocument();
        expect(screen.getByText('v4')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: '导出压缩包'}));

        expect(clickSpy).toHaveBeenCalled();
        expect(DatasetExportSelection.set).toHaveBeenCalledWith(null);
        expect(PopupActions.close).toHaveBeenCalled();
        clickSpy.mockRestore();
    });
});
