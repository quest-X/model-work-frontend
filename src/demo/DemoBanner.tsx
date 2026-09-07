import React from 'react';
import {isDemoMode} from './DemoMode';

export const DemoBanner: React.FC = () => isDemoMode ? <aside className='DemoBanner' role='status'>
    演示模式 · 真实 goose 数据子集 · 操作不写入服务器
</aside> : null;
