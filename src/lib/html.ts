/**
 * Bits of HTML for the status texts of the settings (`state` controls with `html`)
 */

/**
 * Make a text safe for HTML
 *
 * @param text - any text
 */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/**
 * A link that opens in a new window; anything but https (or http where allowed) stays plain text
 *
 * @param url - where to
 * @param text - what is shown
 * @param allowHttp - also http: a server in the own network, like Immich in Docker
 */
export function link(url: string, text: string, allowHttp = false): string {
    return (allowHttp ? /^https?:\/\//i : /^https:\/\//i).test(url)
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;font-weight:bold;text-decoration:underline">${escapeHtml(text)}</a>`
        : escapeHtml(text);
}
