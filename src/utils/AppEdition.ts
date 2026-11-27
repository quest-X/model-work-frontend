declare const __OPENSIGHT_EDITION__: string;

export const appEdition = typeof __OPENSIGHT_EDITION__ !== 'undefined' && __OPENSIGHT_EDITION__ === 'Main'
    ? 'Main' : 'Master';
