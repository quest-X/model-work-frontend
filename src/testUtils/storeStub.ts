import configureStore from '../configureStore';

// 测试只需要单例 store；真实入口还会启动 React 和 Vite HMR（import.meta），Jest 解析不了。
export const store = configureStore();
