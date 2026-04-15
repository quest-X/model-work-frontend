export class XMLSanitizerUtil {
    public static sanitize(input: string): string {
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;')
            .replace(/\//g, '&#x2F;');
    }
}