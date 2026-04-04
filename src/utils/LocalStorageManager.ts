import { Language } from '../data/LanguageConfig';

export interface ProjectSettings {
    language: Language;
    projectName: string;
    lastSaved: number;
    zoom: number;
    imageDragMode: boolean;
    crossHairVisible: boolean;
    currentImageIndex: number;
    activeLabelType: string;
}

export class LocalStorageManager {
    private static readonly STORAGE_KEY = 'make-sense-project-settings';
    
    public static saveSettings(settings: Partial<ProjectSettings>): void {
        try {
            const existingSettings = this.getSettings();
            const updatedSettings: ProjectSettings = {
                ...existingSettings,
                ...settings,
                lastSaved: Date.now()
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedSettings));
            // 静默保存
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    }
    
    public static getSettings(): ProjectSettings {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('读取设置失败:', error);
        }
        
        // 返回默认设置
        return {
            language: Language.CHINESE,
            projectName: 'my-project',
            lastSaved: 0,
            zoom: 1,
            imageDragMode: false,
            crossHairVisible: false,
            currentImageIndex: 0,
            activeLabelType: 'RECT'
        };
    }
    
    public static hasStoredSettings(): boolean {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return !!stored;
        } catch (error) {
            return false;
        }
    }
    
    public static clearSettings(): void {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            console.log('项目设置已清除');
        } catch (error) {
            console.error('清除设置失败:', error);
        }
    }
    
    public static getLastSavedTime(): number {
        const settings = this.getSettings();
        return settings.lastSaved;
    }
}
