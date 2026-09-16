import React from 'react';
import {render, screen} from '@testing-library/react';
import {Language} from '../../../../../data/LanguageConfig';
import DropDownMenu from '../DropDownMenu';

jest.mock('../../../../../data/info/DropDownMenuData', () => ({
    getDropDownMenuData: () => [{
        children: ['引擎管理', '编辑标签', '上传文件', '导入标注', '导出标注'].map(name => ({
            name,
            imageSrc: '',
            imageAlt: '',
            disabled: false,
        })),
    }],
}));

describe('DropDownMenu commercial restrictions', () => {
    it('allows engine management while keeping other actions disabled', () => {
        render(<DropDownMenu
            language={Language.CHINESE}
            forceDisabled
            allowEngineManagement
        />);

        expect(screen.getByText('引擎管理').closest('button')).toBeEnabled();
        for (const name of ['编辑标签', '上传文件', '导入标注', '导出标注']) {
            expect(screen.getByText(name).closest('button')).toBeDisabled();
        }
    });
});
