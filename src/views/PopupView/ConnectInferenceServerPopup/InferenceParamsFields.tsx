import React from 'react';
import { StyledTextField } from '../../Common/StyledTextField/StyledTextField';
import { InferenceParams } from '../../../ai/DetectionAPIDetector';

interface IProps {
    params: InferenceParams;
    onChange: (next: InferenceParams) => void;
}

export const InferenceParamsFields: React.FC<IProps> = ({ params, onChange }) => {
    const update = (key: keyof InferenceParams, raw: string) => {
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        onChange({ ...params, [key]: n });
    };

    const field = (key: keyof InferenceParams, label: string, step: string) => (
        <StyledTextField
            variant='standard'
            id={`inference-${key}`}
            autoComplete={'off'}
            type={'number'}
            margin={'dense'}
            label={label}
            value={params[key]}
            inputProps={{ step }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update(key, e.target.value)}
            style={{ width: 130, marginRight: 12 }}
            InputLabelProps={{ shrink: true }}
        />
    );

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 12 }}>
            {field('conf', 'conf', '0.01')}
            {field('iou', 'iou', '0.01')}
            {field('imgsz', 'imgsz', '32')}
            {field('max_det', 'max_det', '1')}
        </div>
    );
};
