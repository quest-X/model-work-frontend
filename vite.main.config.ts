import {UserConfig} from 'vite';
import baseConfig from './vite.config';

export default (environment: Parameters<typeof baseConfig>[0]) => {
    const config = baseConfig(environment) as UserConfig;
    return {...config, define: {...config.define, __OPENSIGHT_EDITION__: JSON.stringify('Main')}};
};
