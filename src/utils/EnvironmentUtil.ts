export class EnvironmentUtil {
    public static isProd(): boolean {
        return process.env.NODE_ENV === 'production';
    }
}