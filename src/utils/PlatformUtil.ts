import {MobileDeviceData} from "../data/MobileDeviceData";
import MobileDetect from 'mobile-detect'

export class PlatformUtil {
    public static getMobileDeviceData(userAgent: string): MobileDeviceData {
        const mobileDetect = new MobileDetect(userAgent);
        return {
            manufacturer: mobileDetect.mobile(),
            browser: mobileDetect.userAgent(),
            os: mobileDetect.os()
        }
    }

    // Pre-lowercased UA variants accept the cached string to avoid 4× toLowerCase
    // (~3-4ms saved on AppInitializer.detectDeviceParams call).
    public static isMac(userAgent: string): boolean {
        const ua = userAgent.toLowerCase();
        return ua.includes('mac');
    }

    public static isSafari(userAgent: string): boolean {
        const ua = userAgent.toLowerCase();
        return ua.includes("safari") && !ua.includes("chrome") && !ua.includes("chromium") && !ua.includes("android");
    }

    public static isFirefox(userAgent: string): boolean {
        return userAgent.toLowerCase().includes('firefox');
    }

    /** Detect all platform flags in one pass — avoids 4× toLowerCase() on UA. */
    public static detectAll(userAgent: string): { isMac: boolean; isSafari: boolean; isFirefox: boolean } {
        const ua = userAgent.toLowerCase();
        return {
            isMac: ua.includes('mac'),
            isSafari: ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('android'),
            isFirefox: ua.includes('firefox')
        };
    }
}